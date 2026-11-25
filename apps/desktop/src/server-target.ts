import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { serverRouteKindSchema, type ServerRouteKind } from "@bb/domain";
import { orderServerRoutes, serverRouteKey } from "@bb/server-routes";
import { sliceUtf16Head } from "@bb/text-utils";

export const SERVER_TARGET_FILE_NAME = "server-target.json";
export const MAX_SERVER_NAME_LENGTH = 64;

interface CustomServer {
  url: string;
  name: string | null;
}

interface SetCustomServerUrlOptions {
  availableConnectServers?: readonly ConnectServerRef[];
  replacedUrl?: string;
  name?: string | null;
}

export function builtinServerName(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "This Mac" : "This Computer";
}

export const BUILTIN_SERVER_NAME = builtinServerName(process.platform);

export interface ConnectServerRef {
  handle: string;
  name: string;
  url: string;
}

export interface ServerRouteEntry {
  url: string;
  kind: ServerRouteKind;
  providerId: string | null;
  label: string;
}

export interface RoutedServer {
  serverId: string;
  name: string | null;
  addedUrl: string;
  advertisedRoutes: ServerRouteEntry[];
  userRoutes: ServerRouteEntry[];
  pinnedRouteUrl: string | null;
}

export interface AdoptRoutedServerArgs {
  serverId: string;
  addedRoute: ServerRouteEntry;
  advertisedRoutes: readonly ServerRouteEntry[] | null;
  select: boolean;
}

type DesktopServerTarget =
  | { kind: "builtin" }
  | { kind: "connect"; server: ConnectServerRef }
  | { kind: "custom"; url: string }
  | { kind: "server"; server: RoutedServer };

type LegacyTargetKind = "builtin" | "connect" | "custom";

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
  adoptConnectServers(servers: readonly ConnectServerRef[]): Promise<boolean>;
  adoptRoutedServer(args: AdoptRoutedServerArgs): Promise<RoutedServer>;
  getRoutedServer(serverId: string): RoutedServer | null;
  getRoutedServers(): RoutedServer[];
  removeRoutedServer(serverId: string): Promise<void>;
  selectRoutedServer(serverId: string): Promise<boolean>;
  setRoutedServerName(serverId: string, name: string | null): Promise<void>;
  setRoutedServerPinnedRoute(
    serverId: string,
    url: string | null,
  ): Promise<boolean>;
  setRoutedServerRoutes(
    serverId: string,
    advertisedRoutes: readonly ServerRouteEntry[],
  ): Promise<RoutedServer | null>;
  getConnectServer(): ConnectServerRef | null;
  getConnectServerName(handle: string): string | null;
  getCustomServerUrl(): string | null;
  getCustomServerUrls(): string[];
  getCustomServers(): CustomServer[];
  setCustomServerName(url: string, name: string | null): Promise<void>;
  getTarget(): DesktopServerTarget;
  getShowBuiltinServer(): boolean;
  setShowBuiltinServer(show: boolean): Promise<void>;
  load(): Promise<void>;
  refreshConnectServer(server: ConnectServerRef): Promise<boolean>;
  setConnectServer(server: ConnectServerRef): Promise<void>;
  setConnectServerName(handle: string, name: string | null): Promise<void>;
  setCustomServerUrl(
    url: string | null,
    options?: SetCustomServerUrlOptions,
  ): Promise<void>;
  setTarget(kind: "builtin" | "connect" | "custom"): Promise<boolean>;
}

const persistedConnectServerSchema = z.object({
  handle: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
});

const persistedServerRouteSchema = z.object({
  url: z.string().min(1),
  kind: serverRouteKindSchema,
  providerId: z.string().min(1).nullable(),
  label: z.string().min(1),
});

const persistedRoutedServerSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1).nullable(),
  addedUrl: z.string().min(1),
  advertisedRoutes: z.array(persistedServerRouteSchema),
  userRoutes: z.array(persistedServerRouteSchema).min(1),
  pinnedRouteUrl: z.string().min(1).nullable(),
});

const persistedServerTargetSchema = z.looseObject({
  routedServers: z.array(persistedRoutedServerSchema).default([]).catch([]),
  activeRoutedServerId: z.string().min(1).nullable().default(null).catch(null),
  showBuiltinServer: z.boolean().default(true),
  connectServer: persistedConnectServerSchema.nullable().optional(),
  customServerUrl: z.string().min(1).nullable(),
  customServerUrls: z.array(z.string().min(1)).default([]),
  target: z.enum(["builtin", "connect", "custom"]),
  customServerNames: z.record(z.string(), z.unknown()).default({}).catch({}),
  connectServerNames: z.record(z.string(), z.unknown()).default({}).catch({}),
});

type PersistedServerTarget = z.infer<typeof persistedServerTargetSchema>;

export function normalizeServerName(rawName: string): string | null {
  const name = sliceUtf16Head(
    rawName.trim().replace(/\s+/gu, " "),
    MAX_SERVER_NAME_LENGTH,
  ).trimEnd();
  return name.length === 0 ? null : name;
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

export function routedServerRoutes(server: RoutedServer): ServerRouteEntry[] {
  return orderServerRoutes(server.advertisedRoutes, server.userRoutes);
}

export function connectHandleForRoute(route: ServerRouteEntry): string | null {
  if (route.kind !== "relay" || route.providerId !== "connect") return null;
  const label = new URL(route.url).hostname.split(".")[0] ?? "";
  return label.length === 0 ? null : label;
}

function cloneRoutedServer(server: RoutedServer): RoutedServer {
  return {
    ...server,
    advertisedRoutes: server.advertisedRoutes.map((route) => ({ ...route })),
    userRoutes: server.userRoutes.map((route) => ({ ...route })),
  };
}

function normalizeRoute(route: ServerRouteEntry): ServerRouteEntry | null {
  const url = normalizeCustomServerUrl(route.url);
  return url === null ? null : { ...route, url };
}

function normalizeRoutes(
  routes: readonly ServerRouteEntry[],
): ServerRouteEntry[] {
  return orderServerRoutes(
    routes.flatMap((route) => normalizeRoute(route) ?? []),
    [],
  );
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

export function createServerTargetStore(
  args: CreateServerTargetStoreArgs,
): ServerTargetStore {
  const fsImpl = args.fs ?? defaultFs;
  let connectServer: ConnectServerRef | null = null;
  let customServerUrl: string | null = null;
  let customServers: CustomServer[] = [];
  let connectServerNames = new Map<string, string>();
  let target: LegacyTargetKind = "builtin";
  let routedServers: RoutedServer[] = [];
  let activeRoutedServerId: string | null = null;
  let showBuiltinServer = true;
  let persistedSettings: PersistedServerTarget | null = null;
  let pendingPersist: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const customServerNames = Object.fromEntries(
      customServers
        .filter((server) => server.name !== null)
        .map((server) => [server.url, server.name]),
    );
    const payload = {
      ...persistedSettings,
      routedServers: routedServers.length === 0 ? undefined : routedServers,
      activeRoutedServerId: activeRoutedServerId ?? undefined,
      showBuiltinServer: showBuiltinServer ? undefined : false,
      connectServer,
      customServerUrl,
      customServerUrls: customServers.map((server) => server.url),
      customServerNames:
        Object.keys(customServerNames).length === 0
          ? undefined
          : customServerNames,
      connectServerNames:
        connectServerNames.size === 0
          ? undefined
          : Object.fromEntries(connectServerNames),
      target,
    };
    const data = `${JSON.stringify(payload, null, 2)}\n`;
    const write = pendingPersist.then(async () => {
      await fsImpl.mkdir(dirname(args.storagePath), { recursive: true });
      await fsImpl.writeFile(args.storagePath, data, "utf8");
    });
    pendingPersist = write.catch(() => undefined);
    return write;
  }

  function findRoutedServer(serverId: string): RoutedServer | undefined {
    return routedServers.find((server) => server.serverId === serverId);
  }

  function routeKeysOf(server: RoutedServer): Set<string> {
    return new Set(
      routedServerRoutes(server).map((route) => serverRouteKey(route.url)),
    );
  }

  function connectHandlesOf(server: RoutedServer): Set<string> {
    return new Set(
      routedServerRoutes(server).flatMap(
        (route) => connectHandleForRoute(route) ?? [],
      ),
    );
  }

  function customEntryFor(url: string): CustomServer | undefined {
    const key = serverRouteKey(url);
    return customServers.find((custom) => serverRouteKey(custom.url) === key);
  }

  function legacySelectionBelongsTo(server: RoutedServer): boolean {
    if (target === "custom" && customServerUrl !== null) {
      return routeKeysOf(server).has(serverRouteKey(customServerUrl));
    }
    if (target === "connect" && connectServer !== null) {
      return connectHandlesOf(server).has(connectServer.handle);
    }
    return false;
  }

  function activeRoutedServer(): RoutedServer | undefined {
    const server =
      activeRoutedServerId === null
        ? undefined
        : findRoutedServer(activeRoutedServerId);
    return server !== undefined && legacySelectionBelongsTo(server)
      ? server
      : undefined;
  }

  function activateRoutedServer(server: RoutedServer): void {
    activeRoutedServerId = server.serverId;
    if (legacySelectionBelongsTo(server)) return;
    const keys = routeKeysOf(server);
    const addedEntry = customEntryFor(server.addedUrl);
    if (
      addedEntry === undefined &&
      connectServer !== null &&
      connectHandlesOf(server).has(connectServer.handle)
    ) {
      target = "connect";
      return;
    }
    const anchor =
      addedEntry ??
      customServers.find((custom) => keys.has(serverRouteKey(custom.url)));
    if (anchor === undefined) return;
    target = "custom";
    customServerUrl = anchor.url;
  }

  function anchorConnectHandle(server: RoutedServer): string | null {
    const addedKey = serverRouteKey(server.addedUrl);
    const route = routedServerRoutes(server).find(
      (candidate) => serverRouteKey(candidate.url) === addedKey,
    );
    return route === undefined ? null : connectHandleForRoute(route);
  }

  function keepLegacyEntry(route: ServerRouteEntry): void {
    if (connectHandleForRoute(route) !== null) return;
    if (customEntryFor(route.url) === undefined) {
      customServers.push({ url: route.url, name: null });
    }
  }

  function foldEntriesInto(server: RoutedServer): void {
    const keys = routeKeysOf(server);
    const folded = customServers.filter((custom) =>
      keys.has(serverRouteKey(custom.url)),
    );
    server.name ??= folded.find((custom) => custom.name !== null)?.name ?? null;
    server.userRoutes = orderServerRoutes(
      server.userRoutes,
      folded.map((custom) => ({
        url: custom.url,
        kind: "custom" as const,
        providerId: null,
        label: new URL(custom.url).host,
      })),
    );
    for (const route of routedServerRoutes(server)) {
      const handle = connectHandleForRoute(route);
      if (handle === null) continue;
      server.name ??= connectServerNames.get(handle) ?? null;
      if (connectServer?.handle === handle) {
        server.userRoutes = orderServerRoutes(server.userRoutes, [route]);
      }
    }
    if (legacySelectionBelongsTo(server)) {
      activeRoutedServerId = server.serverId;
    }
  }

  function clearUnknownPin(server: RoutedServer): void {
    if (
      server.pinnedRouteUrl !== null &&
      !routedServerRoutes(server).some(
        (route) => route.url === server.pinnedRouteUrl,
      )
    ) {
      server.pinnedRouteUrl = null;
    }
  }

  return {
    async adoptRoutedServer(adopt) {
      const addedRoute = normalizeRoute(adopt.addedRoute);
      if (addedRoute === null) {
        throw new Error("Enter a valid http(s) URL.");
      }
      let server = findRoutedServer(adopt.serverId);
      if (server === undefined) {
        server = {
          serverId: adopt.serverId,
          name: null,
          addedUrl: addedRoute.url,
          advertisedRoutes: [],
          userRoutes: [],
          pinnedRouteUrl: null,
        };
        routedServers.push(server);
      }
      server.userRoutes = orderServerRoutes(server.userRoutes, [addedRoute]);
      keepLegacyEntry(addedRoute);
      if (adopt.advertisedRoutes !== null) {
        server.advertisedRoutes = normalizeRoutes(adopt.advertisedRoutes);
      }
      foldEntriesInto(server);
      clearUnknownPin(server);
      if (adopt.select) activateRoutedServer(server);
      await persist();
      return cloneRoutedServer(server);
    },
    getRoutedServer(serverId) {
      const server = findRoutedServer(serverId);
      return server === undefined ? null : cloneRoutedServer(server);
    },
    getRoutedServers() {
      return routedServers.map(cloneRoutedServer);
    },
    async removeRoutedServer(serverId) {
      const server = findRoutedServer(serverId);
      if (server === undefined) return;
      const wasSelected = legacySelectionBelongsTo(server);
      const keys = routeKeysOf(server);
      const handles = connectHandlesOf(server);
      routedServers = routedServers.filter(
        (candidate) => candidate.serverId !== serverId,
      );
      customServers = customServers.filter(
        (custom) => !keys.has(serverRouteKey(custom.url)),
      );
      for (const handle of handles) connectServerNames.delete(handle);
      if (connectServer !== null && handles.has(connectServer.handle)) {
        connectServer = null;
      }
      if (
        customServerUrl !== null &&
        keys.has(serverRouteKey(customServerUrl))
      ) {
        customServerUrl = customServers[0]?.url ?? null;
      }
      if (activeRoutedServerId === serverId) activeRoutedServerId = null;
      if (wasSelected) target = "builtin";
      await persist();
    },
    async selectRoutedServer(serverId) {
      const server = findRoutedServer(serverId);
      if (server === undefined) return false;
      if (activeRoutedServer()?.serverId === serverId) return true;
      activateRoutedServer(server);
      await persist();
      return true;
    },
    async setRoutedServerName(serverId, name) {
      const server = findRoutedServer(serverId);
      if (server === undefined) {
        throw new Error("That server is no longer saved.");
      }
      server.name = name === null ? null : normalizeServerName(name);
      const anchor = customEntryFor(server.addedUrl);
      const handle = anchorConnectHandle(server);
      if (anchor !== undefined) {
        anchor.name = server.name;
      } else if (handle !== null && server.name !== null) {
        connectServerNames.set(handle, server.name);
      } else if (handle !== null) {
        connectServerNames.delete(handle);
      }
      await persist();
    },
    async setRoutedServerPinnedRoute(serverId, url) {
      const server = findRoutedServer(serverId);
      if (
        server === undefined ||
        (url !== null &&
          !routedServerRoutes(server).some((route) => route.url === url))
      ) {
        return false;
      }
      if (server.pinnedRouteUrl !== url) {
        server.pinnedRouteUrl = url;
        await persist();
      }
      return true;
    },
    async setRoutedServerRoutes(serverId, advertisedRoutes) {
      const server = findRoutedServer(serverId);
      if (server === undefined) return null;
      const before = JSON.stringify({ server, activeRoutedServerId });
      server.advertisedRoutes = normalizeRoutes(advertisedRoutes);
      foldEntriesInto(server);
      clearUnknownPin(server);
      if (JSON.stringify({ server, activeRoutedServerId }) !== before) {
        await persist();
      }
      return cloneRoutedServer(server);
    },
    getShowBuiltinServer() {
      return showBuiltinServer;
    },
    async setShowBuiltinServer(show) {
      showBuiltinServer = show;
      await persist();
    },
    async adoptConnectServers(servers) {
      const serversByUrl = new Map<string, ConnectServerRef>();
      for (const server of servers) {
        const url = normalizeCustomServerUrl(server.url);
        if (url !== null) serversByUrl.set(url, server);
      }
      const remaining = customServers.filter(
        (server) => !serversByUrl.has(server.url),
      );
      if (remaining.length === customServers.length) {
        return false;
      }
      const adopted =
        target === "custom" && customServerUrl !== null
          ? serversByUrl.get(customServerUrl)
          : undefined;
      for (const custom of customServers) {
        const server = serversByUrl.get(custom.url);
        if (
          server !== undefined &&
          custom.name !== null &&
          !connectServerNames.has(server.handle)
        ) {
          connectServerNames.set(server.handle, custom.name);
        }
      }
      customServers = remaining;
      if (customServerUrl !== null && serversByUrl.has(customServerUrl)) {
        customServerUrl = remaining[0]?.url ?? null;
      }
      if (adopted !== undefined) {
        connectServer = { ...adopted };
        target = "connect";
      }
      await persist();
      return adopted !== undefined;
    },
    getConnectServer() {
      return connectServer === null ? null : { ...connectServer };
    },
    getConnectServerName(handle) {
      return connectServerNames.get(handle) ?? null;
    },
    getCustomServerUrl() {
      return customServerUrl;
    },
    getCustomServerUrls() {
      return customServers.map((server) => server.url);
    },
    getCustomServers() {
      return customServers.map((server) => ({ ...server }));
    },
    getTarget() {
      const routed = activeRoutedServer();
      if (routed !== undefined) {
        return { kind: "server", server: cloneRoutedServer(routed) };
      }
      if (target === "custom" && customServerUrl !== null) {
        return { kind: "custom", url: customServerUrl };
      }
      if (target === "connect" && connectServer !== null) {
        return { kind: "connect", server: { ...connectServer } };
      }
      return { kind: "builtin" };
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
      persistedSettings = persisted;
      showBuiltinServer = persisted?.showBuiltinServer ?? true;
      if (persisted === null) {
        routedServers = [];
        activeRoutedServerId = null;
        connectServer = null;
        customServerUrl = null;
        customServers = [];
        connectServerNames = new Map();
        target = "builtin";
        return;
      }
      routedServers = persisted.routedServers.flatMap((server) => {
        const userRoutes = normalizeRoutes(server.userRoutes);
        const addedUrl = normalizeCustomServerUrl(server.addedUrl);
        return userRoutes.length === 0 || addedUrl === null
          ? []
          : [
              {
                ...server,
                addedUrl,
                advertisedRoutes: normalizeRoutes(server.advertisedRoutes),
                userRoutes,
              },
            ];
      });
      activeRoutedServerId = persisted.activeRoutedServerId;
      connectServer = persisted.connectServer ?? null;
      customServerUrl =
        persisted.customServerUrl === null
          ? null
          : normalizeCustomServerUrl(persisted.customServerUrl);
      const customServerUrls = [
        ...new Set(
          [
            ...persisted.customServerUrls,
            ...(customServerUrl === null ? [] : [customServerUrl]),
          ]
            .map(normalizeCustomServerUrl)
            .filter((url): url is string => url !== null),
        ),
      ];
      const names = Object.fromEntries(
        Object.entries(persisted.customServerNames).flatMap(
          ([rawUrl, rawName]) => {
            const url = normalizeCustomServerUrl(rawUrl);
            const name =
              typeof rawName === "string" ? normalizeServerName(rawName) : null;
            return url === null || name === null ? [] : [[url, name]];
          },
        ),
      );
      customServers = customServerUrls.map((url) => ({
        url,
        name: names[url] ?? null,
      }));
      connectServerNames = new Map(
        Object.entries(persisted.connectServerNames).flatMap(
          ([handle, rawName]) => {
            const name =
              typeof rawName === "string" ? normalizeServerName(rawName) : null;
            return handle.length === 0 || name === null ? [] : [[handle, name]];
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
    async setConnectServerName(handle, name) {
      const normalized = name === null ? null : normalizeServerName(name);
      if (normalized === null) {
        connectServerNames.delete(handle);
      } else {
        connectServerNames.set(handle, normalized);
      }
      await persist();
    },
    async setCustomServerName(url, name) {
      const server = customServers.find((saved) => saved.url === url);
      if (server === undefined) {
        throw new Error("That server is no longer saved.");
      }
      server.name = name === null ? null : normalizeServerName(name);
      await persist();
    },
    async setCustomServerUrl(url, options = {}) {
      const normalized = url === null ? null : normalizeCustomServerUrl(url);
      if (url !== null && normalized === null) {
        throw new Error("Enter a valid http(s) URL.");
      }
      const removedUrl =
        options.replacedUrl ?? (url === null ? customServerUrl : null);
      const removedIndex = customServers.findIndex(
        (server) => server.url === removedUrl,
      );
      const carriedName = customServers[removedIndex]?.name ?? null;
      customServers = customServers.filter(
        (server) => server.url !== removedUrl,
      );
      if (normalized === null) {
        customServerUrl = customServers[0]?.url ?? null;
        if (target === "custom") {
          const fallbackConnectServer =
            connectServer ??
            [...(options.availableConnectServers ?? [])].sort((a, b) =>
              a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0,
            )[0] ??
            null;
          if (showBuiltinServer) {
            target = "builtin";
          } else if (customServerUrl !== null) {
            target = "custom";
          } else if (fallbackConnectServer !== null) {
            connectServer = { ...fallbackConnectServer };
            target = "connect";
          } else {
            target = "builtin";
          }
        }
      } else {
        customServerUrl = normalized;
        const existing = customServers.find(
          (server) => server.url === normalized,
        );
        const name =
          options.name === undefined
            ? carriedName
            : options.name === null
              ? null
              : normalizeServerName(options.name);
        if (existing === undefined) {
          customServers.splice(
            removedIndex === -1 ? customServers.length : removedIndex,
            0,
            { url: normalized, name },
          );
        } else if (removedUrl === null && options.name !== undefined) {
          existing.name = name;
        }
        target = "custom";
      }
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
