import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const SERVER_TARGET_FILE_NAME = "server-target.json";
export const SERVER_MENU_FILE_NAME = "server-menu.json";
export const MAX_SERVER_NAME_LENGTH = 64;
export function builtinServerName(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "This Mac" : "This Computer";
}

export const BUILTIN_SERVER_NAME = builtinServerName(process.platform);

export interface ConnectServerRef {
  handle: string;
  name: string;
  url: string;
}

export interface CustomServer {
  name: string | null;
  url: string;
}

interface SetCustomServerUrlOptions {
  name?: string | null;
  replacedUrl?: string;
}

export type DesktopServerTarget =
  | { kind: "builtin" }
  | { kind: "connect"; server: ConnectServerRef }
  | { kind: "custom"; url: string };

export interface ServerTargetFs {
  mkdir(
    path: string,
    options: { recursive: true },
  ): Promise<string | undefined>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

interface CreateServerTargetStoreArgs {
  fs?: ServerTargetFs;
  storagePath: string;
}

export interface ServerTargetStore {
  getConnectServer(): ConnectServerRef | null;
  getCustomServerUrl(): string | null;
  getCustomServers(): CustomServer[];
  getShowBuiltinServer(): boolean;
  getTarget(): DesktopServerTarget;
  load(): Promise<void>;
  refreshConnectServer(server: ConnectServerRef): Promise<boolean>;
  setConnectServer(server: ConnectServerRef): Promise<void>;
  setCustomServerName(url: string, name: string | null): Promise<void>;
  setCustomServerUrl(
    url: string | null,
    options?: SetCustomServerUrlOptions,
  ): Promise<void>;
  setShowBuiltinServer(show: boolean): Promise<void>;
  setTarget(kind: "builtin" | "connect" | "custom"): Promise<boolean>;
}

const persistedConnectServerSchema = z.object({
  handle: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
});

const persistedServerTargetSchema = z.object({
  connectServer: persistedConnectServerSchema.nullable().optional(),
  customServerUrl: z.string().min(1).nullable(),
  customServerUrls: z.array(z.string().min(1)).default([]),
  target: z.enum(["builtin", "connect", "custom"]),
});

type PersistedServerTarget = z.infer<typeof persistedServerTargetSchema>;

const persistedServerMenuSchema = z.object({
  customServerNames: z.record(z.string(), z.unknown()).default({}).catch({}),
  showBuiltinServer: z.boolean().default(true).catch(true),
});

type PersistedServerMenu = z.infer<typeof persistedServerMenuSchema>;

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

function collapseServerName(rawName: string): string | null {
  const collapsed = rawName.trim().replace(/\s+/gu, " ");
  return collapsed.length === 0 ? null : collapsed;
}

export function normalizeServerName(rawName: string): string | null {
  const name = collapseServerName(rawName);
  if (name !== null && name.length > MAX_SERVER_NAME_LENGTH) {
    throw new Error(
      `Server names can be at most ${MAX_SERVER_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

async function readPersisted<T>(
  fsImpl: ServerTargetFs,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const parsedJson: unknown = JSON.parse(await fsImpl.readFile(path, "utf8"));
    const parsed = schema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createServerTargetStore(
  args: CreateServerTargetStoreArgs,
): ServerTargetStore {
  const fsImpl = args.fs ?? defaultFs;
  let connectServer: ConnectServerRef | null = null;
  let customServerUrl: string | null = null;
  let customServerUrls: string[] = [];
  let customServerNames = new Map<string, string>();
  let showBuiltinServer = true;
  let target: "builtin" | "connect" | "custom" = "builtin";

  const menuStoragePath = join(
    dirname(args.storagePath),
    SERVER_MENU_FILE_NAME,
  );
  let pendingPersist: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const payload: PersistedServerTarget = {
      connectServer,
      customServerUrl,
      customServerUrls,
      target,
    };
    const menuPayload: PersistedServerMenu = {
      customServerNames: Object.fromEntries(
        customServerUrls.flatMap((url) => {
          const name = customServerNames.get(url);
          return name === undefined ? [] : [[url, name]];
        }),
      ),
      showBuiltinServer,
    };
    const write = pendingPersist.then(async () => {
      await fsImpl.mkdir(dirname(args.storagePath), { recursive: true });
      await fsImpl.writeFile(
        args.storagePath,
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8",
      );
      await fsImpl.writeFile(
        menuStoragePath,
        `${JSON.stringify(menuPayload, null, 2)}\n`,
        "utf8",
      );
    });
    pendingPersist = write.catch(() => undefined);
    return write;
  }

  return {
    getConnectServer() {
      return connectServer === null ? null : { ...connectServer };
    },
    getCustomServerUrl() {
      return customServerUrl;
    },
    getCustomServers() {
      return customServerUrls.map((url) => ({
        name: customServerNames.get(url) ?? null,
        url,
      }));
    },
    getShowBuiltinServer() {
      return showBuiltinServer;
    },
    getTarget() {
      if (target === "custom" && customServerUrl !== null) {
        return { kind: "custom", url: customServerUrl };
      }
      if (target === "connect" && connectServer !== null) {
        return { kind: "connect", server: { ...connectServer } };
      }
      return { kind: "builtin" };
    },
    async load() {
      const persisted = await readPersisted(
        fsImpl,
        args.storagePath,
        persistedServerTargetSchema,
      );
      const persistedMenu = await readPersisted(
        fsImpl,
        menuStoragePath,
        persistedServerMenuSchema,
      );
      showBuiltinServer = persistedMenu?.showBuiltinServer ?? true;
      if (persisted === null) {
        connectServer = null;
        customServerUrl = null;
        customServerUrls = [];
        customServerNames = new Map();
        target = "builtin";
        return;
      }
      connectServer = persisted.connectServer ?? null;
      customServerUrl =
        persisted.customServerUrl === null
          ? null
          : normalizeCustomServerUrl(persisted.customServerUrl);
      customServerUrls = [
        ...new Set(
          [
            ...persisted.customServerUrls,
            ...(customServerUrl === null ? [] : [customServerUrl]),
          ]
            .map(normalizeCustomServerUrl)
            .filter((url): url is string => url !== null),
        ),
      ];
      customServerNames = new Map(
        Object.entries(persistedMenu?.customServerNames ?? {}).flatMap(
          ([rawUrl, rawName]): Array<[string, string]> => {
            const url = normalizeCustomServerUrl(rawUrl);
            const name =
              typeof rawName === "string"
                ? collapseServerName(rawName)?.slice(0, MAX_SERVER_NAME_LENGTH)
                : undefined;
            return url === null ||
              name === undefined ||
              !customServerUrls.includes(url)
              ? []
              : [[url, name]];
          },
        ),
      );
      if (persisted.target === "custom" && customServerUrl !== null) {
        target = "custom";
      } else if (persisted.target === "connect" && connectServer !== null) {
        target = "connect";
      } else {
        target = "builtin";
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
    async setConnectServer(server) {
      connectServer = { ...server };
      target = "connect";
      await persist();
    },
    async setCustomServerName(url, name) {
      if (!customServerUrls.includes(url)) {
        throw new Error("That server is no longer saved.");
      }
      const normalizedName = name === null ? null : normalizeServerName(name);
      if (normalizedName === null) {
        customServerNames.delete(url);
      } else {
        customServerNames.set(url, normalizedName);
      }
      await persist();
    },
    async setCustomServerUrl(url, options = {}) {
      const normalized = url === null ? null : normalizeCustomServerUrl(url);
      if (url !== null && normalized === null) {
        throw new Error("Enter a valid http(s) URL.");
      }
      const name =
        options.name === undefined || options.name === null
          ? options.name
          : normalizeServerName(options.name);
      const removedUrl =
        options.replacedUrl ?? (url === null ? customServerUrl : null);
      const removedIndex =
        removedUrl === null ? -1 : customServerUrls.indexOf(removedUrl);
      const carriedName =
        removedUrl === null ? undefined : customServerNames.get(removedUrl);
      customServerUrls = customServerUrls.filter(
        (saved) => saved !== removedUrl,
      );
      if (removedUrl !== null) {
        customServerNames.delete(removedUrl);
      }
      if (normalized === null) {
        customServerUrl = customServerUrls[0] ?? null;
        if (target === "custom") {
          target =
            customServerUrl !== null && !showBuiltinServer
              ? "custom"
              : "builtin";
        }
      } else {
        customServerUrl = normalized;
        const mergesIntoSaved =
          removedUrl !== null && customServerUrls.includes(normalized);
        if (!customServerUrls.includes(normalized)) {
          customServerUrls.splice(
            removedIndex === -1 ? customServerUrls.length : removedIndex,
            0,
            normalized,
          );
        }
        const nextName = name === undefined ? carriedName : name;
        if (!mergesIntoSaved) {
          if (nextName === null) {
            customServerNames.delete(normalized);
          } else if (nextName !== undefined) {
            customServerNames.set(normalized, nextName);
          }
        }
        target = "custom";
      }
      await persist();
    },
    async setShowBuiltinServer(show) {
      showBuiltinServer = show;
      await persist();
    },
    async setTarget(kind) {
      if (kind === "custom" && customServerUrl === null) {
        return false;
      }
      if (kind === "connect" && connectServer === null) {
        return false;
      }
      if (target === kind) {
        return true;
      }
      target = kind;
      await persist();
      return true;
    },
  };
}
