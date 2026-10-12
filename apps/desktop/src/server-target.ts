import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { WindowStateKey } from "./types.js";

export const SERVER_TARGET_FILE_NAME = "server-target.json";
export function builtinServerName(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "This Mac" : "This Computer";
}

export const BUILTIN_SERVER_NAME = builtinServerName(process.platform);

export interface ConnectServerRef {
  handle: string;
  name: string;
  url: string;
}

export type DesktopServerTarget =
  | { kind: "builtin" }
  | { kind: "connect"; server: ConnectServerRef }
  | { kind: "custom"; url: string };

export type RemoteServerTarget = Exclude<
  DesktopServerTarget,
  { kind: "builtin" }
>;

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
  addCustomServerUrl(url: string): Promise<string>;
  getCustomServerUrls(): string[];
  getDefaultTarget(): DesktopServerTarget;
  getWindowTarget(stateKey: WindowStateKey): DesktopServerTarget | null;
  listReferencedConnectServers(): ConnectServerRef[];
  load(): Promise<void>;
  pruneWindowTargets(keep: ReadonlySet<WindowStateKey>): Promise<void>;
  refreshConnectServer(server: ConnectServerRef): Promise<boolean>;
  removeCustomServerUrl(url: string): Promise<WindowStateKey[]>;
  removeWindowTarget(stateKey: WindowStateKey): Promise<void>;
  replaceCustomServerUrl(
    previousUrl: string,
    url: string,
  ): Promise<WindowStateKey[]>;
  retargetBuiltin(target: RemoteServerTarget): Promise<WindowStateKey[]>;
  setDefaultTarget(target: DesktopServerTarget): Promise<void>;
  setWindowTarget(
    stateKey: WindowStateKey,
    target: DesktopServerTarget,
  ): Promise<void>;
}

const persistedConnectServerSchema = z.object({
  handle: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
});

const persistedWindowTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin") }),
  z.object({
    kind: z.literal("connect"),
    server: persistedConnectServerSchema,
  }),
  z.object({ kind: z.literal("custom"), url: z.string().min(1) }),
]);

const persistedServerTargetSchema = z.object({
  connectServer: persistedConnectServerSchema.nullable().optional(),
  customServerUrl: z.string().min(1).nullable(),
  customServerUrls: z.array(z.string().min(1)).default([]),
  target: z.enum(["builtin", "connect", "custom"]),
  windowTargets: z.record(z.string(), z.unknown()).catch({}),
});

type PersistedServerTarget = z.infer<typeof persistedServerTargetSchema>;

interface PersistedServerTargetFile {
  connectServer: ConnectServerRef | null;
  customServerUrl: string | null;
  customServerUrls: string[];
  target: DesktopServerTarget["kind"];
  windowTargets: Record<WindowStateKey, DesktopServerTarget>;
}

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

export function isSameServerTarget(
  first: DesktopServerTarget,
  second: DesktopServerTarget,
): boolean {
  if (first.kind === "connect" && second.kind === "connect") {
    return (
      first.server.handle === second.server.handle &&
      first.server.name === second.server.name &&
      first.server.url === second.server.url
    );
  }
  if (first.kind === "custom" && second.kind === "custom") {
    return first.url === second.url;
  }
  return first.kind === second.kind;
}

function cloneServerTarget(target: DesktopServerTarget): DesktopServerTarget {
  return target.kind === "connect"
    ? { kind: "connect", server: { ...target.server } }
    : { ...target };
}

function parsePersistedServerTarget(raw: string): PersistedServerTarget | null {
  try {
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = persistedServerTargetSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parsePersistedWindowTarget(raw: unknown): DesktopServerTarget | null {
  const parsed = persistedWindowTargetSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  if (parsed.data.kind === "custom") {
    const url = normalizeCustomServerUrl(parsed.data.url);
    return url === null ? null : { kind: "custom", url };
  }
  if (parsed.data.kind === "connect") {
    return { kind: "connect", server: { ...parsed.data.server } };
  }
  return { kind: "builtin" };
}

export function createServerTargetStore(
  args: CreateServerTargetStoreArgs,
): ServerTargetStore {
  const fsImpl = args.fs ?? defaultFs;
  let customServerUrls: string[] = [];
  let defaultTarget: DesktopServerTarget = { kind: "builtin" };
  let lastConnectServer: ConnectServerRef | null = null;
  let windowTargets = new Map<WindowStateKey, DesktopServerTarget>();
  let pendingPersist: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const payload: PersistedServerTargetFile = {
      connectServer:
        defaultTarget.kind === "connect"
          ? { ...defaultTarget.server }
          : lastConnectServer,
      customServerUrl:
        defaultTarget.kind === "custom" ? defaultTarget.url : null,
      customServerUrls,
      target: defaultTarget.kind,
      windowTargets: Object.fromEntries(windowTargets),
    };
    const data = `${JSON.stringify(payload, null, 2)}\n`;
    const write = pendingPersist.then(async () => {
      await fsImpl.mkdir(dirname(args.storagePath), { recursive: true });
      await fsImpl.writeFile(args.storagePath, data, "utf8");
    });
    pendingPersist = write.catch(() => undefined);
    return write;
  }

  function rememberServer(target: DesktopServerTarget): void {
    if (target.kind === "connect") {
      lastConnectServer = { ...target.server };
    } else if (
      target.kind === "custom" &&
      !customServerUrls.includes(target.url)
    ) {
      customServerUrls.push(target.url);
    }
  }

  function rewriteTargets(
    rewrite: (target: DesktopServerTarget) => DesktopServerTarget | null,
  ): WindowStateKey[] {
    defaultTarget = rewrite(defaultTarget) ?? defaultTarget;
    const rewritten: WindowStateKey[] = [];
    for (const [stateKey, target] of windowTargets) {
      const next = rewrite(target);
      if (next !== null) {
        windowTargets.set(stateKey, next);
        rewritten.push(stateKey);
      }
    }
    return rewritten;
  }

  function requireCustomServerUrl(url: string): string {
    const normalized = normalizeCustomServerUrl(url);
    if (normalized === null) {
      throw new Error("Enter a valid http(s) URL.");
    }
    return normalized;
  }

  return {
    async addCustomServerUrl(url) {
      const normalized = requireCustomServerUrl(url);
      if (!customServerUrls.includes(normalized)) {
        customServerUrls.push(normalized);
        await persist();
      }
      return normalized;
    },
    getCustomServerUrls() {
      return [...customServerUrls];
    },
    getDefaultTarget() {
      return cloneServerTarget(defaultTarget);
    },
    getWindowTarget(stateKey) {
      const target = windowTargets.get(stateKey);
      return target === undefined ? null : cloneServerTarget(target);
    },
    listReferencedConnectServers() {
      const servers = new Map<string, ConnectServerRef>();
      for (const target of [defaultTarget, ...windowTargets.values()]) {
        if (target.kind === "connect" && !servers.has(target.server.handle)) {
          servers.set(target.server.handle, { ...target.server });
        }
      }
      if (
        lastConnectServer !== null &&
        !servers.has(lastConnectServer.handle)
      ) {
        servers.set(lastConnectServer.handle, { ...lastConnectServer });
      }
      return [...servers.values()];
    },
    async load() {
      let persisted: PersistedServerTarget | null = null;
      try {
        persisted = parsePersistedServerTarget(
          await fsImpl.readFile(args.storagePath, "utf8"),
        );
      } catch {
        persisted = null;
      }
      customServerUrls = [];
      defaultTarget = { kind: "builtin" };
      lastConnectServer = null;
      windowTargets = new Map();
      if (persisted === null) {
        return;
      }
      lastConnectServer = persisted.connectServer ?? null;
      const customServerUrl =
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
      if (persisted.target === "custom" && customServerUrl !== null) {
        defaultTarget = { kind: "custom", url: customServerUrl };
      } else if (persisted.target === "connect" && lastConnectServer !== null) {
        defaultTarget = { kind: "connect", server: { ...lastConnectServer } };
      }
      for (const [stateKey, raw] of Object.entries(persisted.windowTargets)) {
        const target = parsePersistedWindowTarget(raw);
        if (stateKey.length === 0 || target === null) {
          continue;
        }
        if (
          target.kind === "custom" &&
          !customServerUrls.includes(target.url)
        ) {
          customServerUrls.push(target.url);
        }
        windowTargets.set(stateKey, target);
      }
    },
    async pruneWindowTargets(keep) {
      let pruned = false;
      for (const stateKey of [...windowTargets.keys()]) {
        if (!keep.has(stateKey)) {
          windowTargets.delete(stateKey);
          pruned = true;
        }
      }
      if (pruned) {
        await persist();
      }
    },
    async refreshConnectServer(server) {
      const isStale = (current: ConnectServerRef): boolean =>
        current.handle === server.handle &&
        (current.name !== server.name || current.url !== server.url);
      const lastStale =
        lastConnectServer !== null && isStale(lastConnectServer);
      const defaultStale =
        defaultTarget.kind === "connect" && isStale(defaultTarget.server);
      if (lastStale) {
        lastConnectServer = { ...server };
      }
      const refreshedWindows = rewriteTargets((target) =>
        target.kind === "connect" && isStale(target.server)
          ? { kind: "connect", server: { ...server } }
          : null,
      );
      if (!lastStale && !defaultStale && refreshedWindows.length === 0) {
        return false;
      }
      await persist();
      return true;
    },
    async removeCustomServerUrl(url) {
      customServerUrls = customServerUrls.filter((saved) => saved !== url);
      const moved = rewriteTargets((target) =>
        target.kind === "custom" && target.url === url
          ? { kind: "builtin" }
          : null,
      );
      await persist();
      return moved;
    },
    async removeWindowTarget(stateKey) {
      if (windowTargets.delete(stateKey)) {
        await persist();
      }
    },
    async replaceCustomServerUrl(previousUrl, url) {
      const normalized = requireCustomServerUrl(url);
      customServerUrls = [
        ...new Set(
          customServerUrls.map((saved) =>
            saved === previousUrl ? normalized : saved,
          ),
        ),
      ];
      if (!customServerUrls.includes(normalized)) {
        customServerUrls.push(normalized);
      }
      const moved = rewriteTargets((target) =>
        target.kind === "custom" && target.url === previousUrl
          ? { kind: "custom", url: normalized }
          : null,
      );
      await persist();
      return moved;
    },
    async retargetBuiltin(target) {
      rememberServer(target);
      const moved = rewriteTargets((current) =>
        current.kind === "builtin" ? cloneServerTarget(target) : null,
      );
      await persist();
      return moved;
    },
    async setDefaultTarget(target) {
      if (isSameServerTarget(defaultTarget, target)) {
        return;
      }
      defaultTarget = cloneServerTarget(target);
      rememberServer(target);
      await persist();
    },
    async setWindowTarget(stateKey, target) {
      const current = windowTargets.get(stateKey);
      if (current !== undefined && isSameServerTarget(current, target)) {
        return;
      }
      windowTargets.set(stateKey, cloneServerTarget(target));
      rememberServer(target);
      await persist();
    },
  };
}
