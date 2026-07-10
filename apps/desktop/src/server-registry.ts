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

export interface ServerRegistry {
  add(args: AddServerRegistryEntryArgs): Promise<DesktopServerRecord>;
  getAutoConnectToLocalServer(): boolean;
  getServer(id: string): DesktopServerRecord | null;
  list(): DesktopServerRecord[];
  load(): Promise<ServerRegistrySnapshot>;
  onChange(listener: ServerRegistryChangeHandler): ServerRegistryUnsubscribe;
  remove(id: string): Promise<boolean>;
  rename(id: string, name: string): Promise<boolean>;
  setAutoConnectToLocalServer(value: boolean): Promise<void>;
  snapshot(): ServerRegistrySnapshot;
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
    servers: [createBuiltinServer(builtinUrl)],
  };
}

function toPersistedRegistry(
  snapshot: ServerRegistrySnapshot,
): PersistedServerRegistry {
  return {
    autoConnectToLocalServer: snapshot.autoConnectToLocalServer,
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
      servers: state.servers.map((server) => ({ ...server })),
    };
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
        servers: [...state.servers, record],
      };
      await persist();
      notify();
      return { ...record };
    },
    getAutoConnectToLocalServer() {
      return state.autoConnectToLocalServer;
    },
    getServer(id) {
      const server = state.servers.find((candidate) => candidate.id === id);
      return server === undefined ? null : { ...server };
    },
    list() {
      return state.servers.map((server) => ({ ...server }));
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
        servers: nextServers,
      };
      await persist();
      notify();
      return true;
    },
    async rename(id, name) {
      const normalized = normalizeServerName(name);
      let changed = false;
      const nextServers = state.servers.map((server) => {
        if (server.id !== id) {
          return server;
        }
        changed = true;
        // Builtin display name is user-renamable; URL always comes from env.
        if (server.source === "builtin") {
          return {
            id: server.id,
            name: normalized,
            source: "builtin" as const,
            url: args.builtinUrl,
          };
        }
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
        servers: state.servers,
      };
      await persist();
      notify();
    },
    snapshot,
  };
}
