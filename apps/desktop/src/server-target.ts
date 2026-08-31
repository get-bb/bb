import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const SERVER_TARGET_FILE_NAME = "server-target.json";
export const BUILTIN_SERVER_NAME = "This Mac";
export const BUILTIN_SERVER_ID = "builtin";
export const CONNECT_SERVER_ID_PREFIX = "connect:";
export const SERVER_TARGET_SCHEMA_VERSION = 2;

export interface ConnectServerRef {
  handle: string;
  name: string;
  url: string;
}

export interface CustomServerRef {
  id: string;
  name: string;
  url: string;
}

type DesktopServerTarget =
  | { kind: "builtin" }
  | { kind: "connect"; server: ConnectServerRef }
  | { kind: "custom"; server: CustomServerRef };

export interface ServerTargetFs {
  mkdir(
    path: string,
    options: { recursive: true },
  ): Promise<string | undefined>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

interface CreateServerTargetStoreArgs {
  createId?: () => string;
  fs?: ServerTargetFs;
  storagePath: string;
}

export interface ServerTargetStore {
  addCustomServer(name: string, url: string): Promise<CustomServerRef | null>;
  getConnectServer(): ConnectServerRef | null;
  getConnectTrusted(): boolean;
  getCustomServers(): CustomServerRef[];
  getSelectedServerId(): string | null;
  getTarget(): DesktopServerTarget;
  load(): Promise<void>;
  refreshConnectServer(server: ConnectServerRef): Promise<boolean>;
  removeCustomServer(id: string): Promise<boolean>;
  setConnectServer(server: ConnectServerRef): Promise<void>;
  setConnectTrusted(trusted: boolean): Promise<void>;
  setSelectedServerId(serverId: string | null): Promise<boolean>;
}

const persistedConnectServerSchema = z
  .object({
    handle: z.string().min(1),
    name: z.string().min(1),
    url: z.string().min(1),
  })
  .strict();

const persistedCustomServerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().min(1),
  })
  .strict();

const persistedServerTargetV1Schema = z
  .object({
    connectServer: persistedConnectServerSchema.nullable().optional(),
    customServerUrl: z.string().min(1).nullable(),
    target: z.enum(["builtin", "connect", "custom"]),
  })
  .strict();

const persistedServerTargetV2Schema = z
  .object({
    connectServer: persistedConnectServerSchema.nullable(),
    connectTrusted: z.boolean(),
    customServers: z.array(persistedCustomServerSchema),
    selectedServerId: z.string().min(1).nullable(),
    version: z.literal(SERVER_TARGET_SCHEMA_VERSION),
  })
  .strict();

type PersistedServerTargetV2 = z.infer<typeof persistedServerTargetV2Schema>;

const defaultFs: ServerTargetFs = {
  mkdir,
  readFile,
  writeFile,
};

export function normalizeCustomServerUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

export function formatCustomServerName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.length > 0 ? parsed.host : url;
  } catch {
    return url;
  }
}

export function connectServerId(handle: string): string {
  return `${CONNECT_SERVER_ID_PREFIX}${handle}`;
}

export function connectServerHandleFromId(serverId: string): string | null {
  if (!serverId.startsWith(CONNECT_SERVER_ID_PREFIX)) {
    return null;
  }
  const handle = serverId.slice(CONNECT_SERVER_ID_PREFIX.length);
  return handle.length === 0 ? null : handle;
}

function migrateV1(
  v1: z.infer<typeof persistedServerTargetV1Schema>,
  createId: () => string,
): PersistedServerTargetV2 {
  const customServers: CustomServerRef[] = [];
  const migratedUrl =
    v1.customServerUrl === null
      ? null
      : normalizeCustomServerUrl(v1.customServerUrl);
  if (migratedUrl !== null) {
    customServers.push({
      id: createId(),
      name: formatCustomServerName(migratedUrl),
      url: migratedUrl,
    });
  }
  const connectServer = v1.connectServer ?? null;
  let selectedServerId: string | null = null;
  if (v1.target === "custom" && customServers[0] !== undefined) {
    selectedServerId = customServers[0].id;
  } else if (v1.target === "connect" && connectServer !== null) {
    selectedServerId = connectServerId(connectServer.handle);
  }
  return {
    connectServer,
    connectTrusted: true,
    customServers,
    selectedServerId,
    version: SERVER_TARGET_SCHEMA_VERSION,
  };
}

function parsePersistedServerTarget(
  raw: string,
  createId: () => string,
): PersistedServerTargetV2 | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  const v2 = persistedServerTargetV2Schema.safeParse(parsedJson);
  if (v2.success) {
    return v2.data;
  }
  const v1 = persistedServerTargetV1Schema.safeParse(parsedJson);
  return v1.success ? migrateV1(v1.data, createId) : null;
}

export function createServerTargetStore(
  args: CreateServerTargetStoreArgs,
): ServerTargetStore {
  const fsImpl = args.fs ?? defaultFs;
  const createId = args.createId ?? (() => randomUUID());
  let connectServer: ConnectServerRef | null = null;
  let connectTrusted = true;
  let customServers: CustomServerRef[] = [];
  let selectedServerId: string | null = null;

  function findCustomServer(id: string): CustomServerRef | null {
    return customServers.find((server) => server.id === id) ?? null;
  }

  function resolveTarget(): DesktopServerTarget {
    if (selectedServerId === null || selectedServerId === BUILTIN_SERVER_ID) {
      return { kind: "builtin" };
    }
    const handle = connectServerHandleFromId(selectedServerId);
    if (handle !== null) {
      if (
        connectTrusted &&
        connectServer !== null &&
        connectServer.handle === handle
      ) {
        return { kind: "connect", server: { ...connectServer } };
      }
      return { kind: "builtin" };
    }
    const custom = findCustomServer(selectedServerId);
    return custom === null
      ? { kind: "builtin" }
      : { kind: "custom", server: { ...custom } };
  }

  async function persist(): Promise<void> {
    await fsImpl.mkdir(dirname(args.storagePath), { recursive: true });
    const payload: PersistedServerTargetV2 = {
      connectServer,
      connectTrusted,
      customServers,
      selectedServerId,
      version: SERVER_TARGET_SCHEMA_VERSION,
    };
    await fsImpl.writeFile(
      args.storagePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    async addCustomServer(name, url) {
      const normalizedUrl = normalizeCustomServerUrl(url);
      if (normalizedUrl === null) {
        return null;
      }
      const existing = customServers.find(
        (server) => server.url === normalizedUrl,
      );
      if (existing !== undefined) {
        return { ...existing };
      }
      const trimmedName = name.trim();
      const added: CustomServerRef = {
        id: createId(),
        name:
          trimmedName.length === 0
            ? formatCustomServerName(normalizedUrl)
            : trimmedName,
        url: normalizedUrl,
      };
      customServers = [...customServers, added];
      await persist();
      return { ...added };
    },
    getConnectServer() {
      return connectServer === null ? null : { ...connectServer };
    },
    getConnectTrusted() {
      return connectTrusted;
    },
    getCustomServers() {
      return customServers.map((server) => ({ ...server }));
    },
    getSelectedServerId() {
      return selectedServerId;
    },
    getTarget() {
      return resolveTarget();
    },
    async load() {
      let persisted: PersistedServerTargetV2 | null = null;
      try {
        persisted = parsePersistedServerTarget(
          await fsImpl.readFile(args.storagePath, "utf8"),
          createId,
        );
      } catch {
        persisted = null;
      }
      if (persisted === null) {
        connectServer = null;
        connectTrusted = true;
        customServers = [];
        selectedServerId = null;
        return;
      }
      connectServer = persisted.connectServer;
      connectTrusted = persisted.connectTrusted;
      customServers = persisted.customServers.flatMap((server) => {
        const normalizedUrl = normalizeCustomServerUrl(server.url);
        return normalizedUrl === null
          ? []
          : [{ ...server, url: normalizedUrl }];
      });
      selectedServerId = persisted.selectedServerId;
      if (resolveTarget().kind === "builtin") {
        selectedServerId = null;
      }
    },
    async refreshConnectServer(server) {
      if (
        connectServer === null ||
        connectServer.handle !== server.handle ||
        (connectServer.name === server.name && connectServer.url === server.url)
      ) {
        return false;
      }
      connectServer = { ...server };
      await persist();
      return true;
    },
    async removeCustomServer(id) {
      if (findCustomServer(id) === null) {
        return false;
      }
      customServers = customServers.filter((server) => server.id !== id);
      if (selectedServerId === id) {
        selectedServerId = null;
      }
      await persist();
      return true;
    },
    async setConnectServer(server) {
      connectServer = { ...server };
      selectedServerId = connectServerId(server.handle);
      await persist();
    },
    async setConnectTrusted(trusted) {
      if (connectTrusted === trusted) {
        return;
      }
      connectTrusted = trusted;
      if (
        !trusted &&
        connectServerHandleFromId(selectedServerId ?? "") !== null
      ) {
        selectedServerId = null;
      }
      await persist();
    },
    async setSelectedServerId(serverId) {
      const next = serverId === BUILTIN_SERVER_ID ? null : serverId;
      if (next !== null) {
        const handle = connectServerHandleFromId(next);
        if (handle !== null) {
          if (
            !connectTrusted ||
            connectServer === null ||
            connectServer.handle !== handle
          ) {
            return false;
          }
        } else if (findCustomServer(next) === null) {
          return false;
        }
      }
      if (selectedServerId === next) {
        return true;
      }
      selectedServerId = next;
      await persist();
      return true;
    },
  };
}
