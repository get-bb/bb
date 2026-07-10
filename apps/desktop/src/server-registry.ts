import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const BUILTIN_SERVER_ID = "builtin-local";
export const BUILTIN_SERVER_NAME = "This Mac";
export const SERVER_REGISTRY_FILE_NAME = "servers.json";

export type DesktopServerSource = "builtin" | "manual" | "connect";

export interface DesktopServerRecord {
  id: string;
  name: string;
  source: DesktopServerSource;
  url: string;
}

export interface ServerRegistrySnapshot {
  autoConnectToLocalServer: boolean;
  showConnectServers: boolean;
  servers: DesktopServerRecord[];
}

export type ServerRegistryChangeHandler = (
  snapshot: ServerRegistrySnapshot,
) => void;
export type ServerRegistryUnsubscribe = () => void;

export interface ServerRegistryFs {
  mkdir(
    path: string,
    options: { recursive: true },
  ): Promise<string | undefined>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

export interface CreateServerRegistryArgs {
  builtinUrl: string;
  fs?: ServerRegistryFs;
  storagePath: string;
}

export interface AddServerRegistryEntryArgs {
  name: string;
  source: Exclude<DesktopServerSource, "builtin">;
  url: string;
}

export interface UpsertServerRegistryEntryArgs {
  id: string;
  name: string;
  source: Exclude<DesktopServerSource, "builtin">;
  url: string;
}

export interface ServerRegistry {
  add(args: AddServerRegistryEntryArgs): Promise<DesktopServerRecord>;
  getAutoConnectToLocalServer(): boolean;
  getServer(id: string): DesktopServerRecord | null;
  getShowConnectServers(): boolean;
  /**
   * Visible servers for list/menu output. When `showConnectServers` is false,
   * connect-source entries are omitted (they remain in storage/snapshot).
   */
  list(): DesktopServerRecord[];
  load(): Promise<ServerRegistrySnapshot>;
  onChange(listener: ServerRegistryChangeHandler): ServerRegistryUnsubscribe;
  remove(id: string): Promise<boolean>;
  /**
   * Remove entries with the given source whose id is not in `keepIds`.
   * Returns the removed ids.
   */
  removeBySource(
    source: Exclude<DesktopServerSource, "builtin">,
    keepIds: ReadonlySet<string>,
  ): Promise<string[]>;
  rename(id: string, name: string): Promise<boolean>;
  setAutoConnectToLocalServer(value: boolean): Promise<void>;
  setShowConnectServers(value: boolean): Promise<void>;
  snapshot(): ServerRegistrySnapshot;
  /**
   * Insert or replace a remote entry by stable id (used for connect sync).
   */
  upsert(args: UpsertServerRegistryEntryArgs): Promise<DesktopServerRecord>;
}

const persistedServerSourceSchema = z.enum(["manual", "connect"]);

const persistedServerRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: persistedServerSourceSchema,
    url: z.string().min(1),
  })
  .strict();

const persistedServerRegistrySchema = z
  .object({
    autoConnectToLocalServer: z.boolean(),
    // Absent on older files → treated as true at the load boundary.
    showConnectServers: z.boolean().optional(),
    servers: z.array(persistedServerRecordSchema),
  })
  .strict();

type PersistedServerRegistry = z.infer<typeof persistedServerRegistrySchema>;

const defaultFs: ServerRegistryFs = {
  mkdir,
  readFile,
  writeFile,
};

function createBuiltinServer(builtinUrl: string): DesktopServerRecord {
  return {
    id: BUILTIN_SERVER_ID,
    name: BUILTIN_SERVER_NAME,
    source: "builtin",
    url: builtinUrl,
  };
}

function createDefaultSnapshot(builtinUrl: string): ServerRegistrySnapshot {
  return {
    autoConnectToLocalServer: true,
    showConnectServers: true,
    servers: [createBuiltinServer(builtinUrl)],
  };
}

function toPersistedRegistry(
  snapshot: ServerRegistrySnapshot,
): PersistedServerRegistry {
  return {
    autoConnectToLocalServer: snapshot.autoConnectToLocalServer,
    showConnectServers: snapshot.showConnectServers,
    servers: snapshot.servers
      .filter((server) => server.source !== "builtin")
      .map((server) => ({
        id: server.id,
        name: server.name,
        source: server.source === "connect" ? "connect" : "manual",
        url: server.url,
      })),
  };
}

function fromPersistedRegistry(args: {
  builtinUrl: string;
  persisted: PersistedServerRegistry;
}): ServerRegistrySnapshot {
  const seenIds = new Set<string>([BUILTIN_SERVER_ID]);
  const remoteServers: DesktopServerRecord[] = [];
  for (const server of args.persisted.servers) {
    if (server.id === BUILTIN_SERVER_ID || seenIds.has(server.id)) {
      continue;
    }
    seenIds.add(server.id);
    remoteServers.push({
      id: server.id,
      name: server.name,
      source: server.source,
      url: server.url,
    });
  }
  return {
    autoConnectToLocalServer: args.persisted.autoConnectToLocalServer,
    showConnectServers: args.persisted.showConnectServers ?? true,
    servers: [createBuiltinServer(args.builtinUrl), ...remoteServers],
  };
}

function parsePersistedRegistry(raw: string): PersistedServerRegistry | null {
  try {
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = persistedServerRegistrySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function normalizeServerName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : "Server";
}

function defaultNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.length > 0 ? parsed.host : url;
  } catch {
    return url;
  }
}

function copyRecord(server: DesktopServerRecord): DesktopServerRecord {
  return { ...server };
}

export function connectServerId(handle: string): string {
  return `connect:${handle}`;
}

export function createServerRegistry(
  args: CreateServerRegistryArgs,
): ServerRegistry {
  const fsImpl = args.fs ?? defaultFs;
  let state = createDefaultSnapshot(args.builtinUrl);
  const listeners = new Set<ServerRegistryChangeHandler>();

  function notify(): void {
    const current = snapshot();
    for (const listener of listeners) {
      listener(current);
    }
  }

  function snapshot(): ServerRegistrySnapshot {
    return {
      autoConnectToLocalServer: state.autoConnectToLocalServer,
      showConnectServers: state.showConnectServers,
      servers: state.servers.map(copyRecord),
    };
  }

  function visibleServers(): DesktopServerRecord[] {
    if (state.showConnectServers) {
      return state.servers.map(copyRecord);
    }
    return state.servers
      .filter((server) => server.source !== "connect")
      .map(copyRecord);
  }

  async function persist(): Promise<void> {
    await fsImpl.mkdir(dirname(args.storagePath), { recursive: true });
    const payload = `${JSON.stringify(toPersistedRegistry(state), null, 2)}\n`;
    await fsImpl.writeFile(args.storagePath, payload, "utf8");
  }

  async function load(): Promise<ServerRegistrySnapshot> {
    try {
      const raw = await fsImpl.readFile(args.storagePath, "utf8");
      const persisted = parsePersistedRegistry(raw);
      if (persisted === null) {
        state = createDefaultSnapshot(args.builtinUrl);
      } else {
        state = fromPersistedRegistry({
          builtinUrl: args.builtinUrl,
          persisted,
        });
      }
    } catch {
      state = createDefaultSnapshot(args.builtinUrl);
    }
    notify();
    return snapshot();
  }

  return {
    async add(addArgs) {
      const url = addArgs.url.trim();
      const name = normalizeServerName(
        addArgs.name.length > 0 ? addArgs.name : defaultNameFromUrl(url),
      );
      const record: DesktopServerRecord = {
        id: randomUUID(),
        name,
        source: addArgs.source,
        url,
      };
      state = {
        autoConnectToLocalServer: state.autoConnectToLocalServer,
        showConnectServers: state.showConnectServers,
        servers: [...state.servers, record],
      };
      await persist();
      notify();
      return copyRecord(record);
    },
    getAutoConnectToLocalServer() {
      return state.autoConnectToLocalServer;
    },
    getServer(id) {
      const server = state.servers.find((candidate) => candidate.id === id);
      return server === undefined ? null : copyRecord(server);
    },
    getShowConnectServers() {
      return state.showConnectServers;
    },
    list() {
      return visibleServers();
    },
    load,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async remove(id) {
      if (id === BUILTIN_SERVER_ID) {
        return false;
      }
      const nextServers = state.servers.filter((server) => server.id !== id);
      if (nextServers.length === state.servers.length) {
        return false;
      }
      state = {
        autoConnectToLocalServer: state.autoConnectToLocalServer,
        showConnectServers: state.showConnectServers,
        servers: nextServers,
      };
      await persist();
      notify();
      return true;
    },
    async removeBySource(source, keepIds) {
      const removedIds: string[] = [];
      const nextServers = state.servers.filter((server) => {
        if (server.source !== source || keepIds.has(server.id)) {
          return true;
        }
        removedIds.push(server.id);
        return false;
      });
      if (removedIds.length === 0) {
        return [];
      }
      state = {
        autoConnectToLocalServer: state.autoConnectToLocalServer,
        showConnectServers: state.showConnectServers,
        servers: nextServers,
      };
      await persist();
      notify();
      return removedIds;
    },
    async rename(id, name) {
      // Builtin name is fixed ("This Mac"); only remote entries are renamable.
      if (id === BUILTIN_SERVER_ID) {
        return false;
      }
      const normalized = normalizeServerName(name);
      let changed = false;
      const nextServers = state.servers.map((server) => {
        if (server.id !== id || server.source === "builtin") {
          return server;
        }
        changed = true;
        return {
          ...server,
          name: normalized,
        };
      });
      if (!changed) {
        return false;
      }
      state = {
        autoConnectToLocalServer: state.autoConnectToLocalServer,
        showConnectServers: state.showConnectServers,
        servers: nextServers,
      };
      await persist();
      notify();
      return true;
    },
    async setAutoConnectToLocalServer(value) {
      if (state.autoConnectToLocalServer === value) {
        return;
      }
      state = {
        autoConnectToLocalServer: value,
        showConnectServers: state.showConnectServers,
        servers: state.servers,
      };
      await persist();
      notify();
    },
    async setShowConnectServers(value) {
      if (state.showConnectServers === value) {
        return;
      }
      state = {
        autoConnectToLocalServer: state.autoConnectToLocalServer,
        showConnectServers: value,
        servers: state.servers,
      };
      await persist();
      notify();
    },
    snapshot,
    async upsert(upsertArgs) {
      if (upsertArgs.id === BUILTIN_SERVER_ID) {
        throw new Error("cannot upsert the builtin server");
      }
      const url = upsertArgs.url.trim();
      const name = normalizeServerName(
        upsertArgs.name.length > 0 ? upsertArgs.name : defaultNameFromUrl(url),
      );
      const record: DesktopServerRecord = {
        id: upsertArgs.id,
        name,
        source: upsertArgs.source,
        url,
      };
      const existingIndex = state.servers.findIndex(
        (server) => server.id === upsertArgs.id,
      );
      let nextServers: DesktopServerRecord[];
      if (existingIndex === -1) {
        nextServers = [...state.servers, record];
      } else {
        const existing = state.servers[existingIndex];
        if (
          existing !== undefined &&
          existing.name === record.name &&
          existing.source === record.source &&
          existing.url === record.url
        ) {
          return copyRecord(existing);
        }
        nextServers = state.servers.map((server, index) =>
          index === existingIndex ? record : server,
        );
      }
      state = {
        autoConnectToLocalServer: state.autoConnectToLocalServer,
        showConnectServers: state.showConnectServers,
        servers: nextServers,
      };
      await persist();
      notify();
      return copyRecord(record);
    },
  };
}
