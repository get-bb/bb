import type {
  BbDesktopServerRoute,
  BbDesktopServerRouteChange,
} from "@bb/desktop-contract";
import {
  probeServerRoute,
  serverRouteKey,
  type ServerRouteFetch,
} from "@bb/server-routes";
import type { AdvertisedServerRoutes } from "./desktop-system-config.js";
import {
  createRoutedServerSession,
  retargetedWindowUrl,
  type RouteProbeOutcome,
  type RouteSwitch,
  type RoutedServerSession,
} from "./routed-server-session.js";
import {
  connectHandleForRoute,
  routedServerRoutes,
  type RoutedServer,
  type ServerRouteEntry,
  type ServerTargetStore,
} from "./server-target.js";

const CONNECT_ROUTE_SESSION_MIN_REMAINING_MS = 60_000;
const ROUTE_ACTIVATION_CHECK_INTERVAL_MS = 10_000;
const CONNECT_ROUTE_LABEL = "bb connect";

export type ConnectRouteAuthentication =
  | { ok: true; expiresAt: number }
  | { ok: false; code: string; detail: string };

export interface RoutedServerControllerDeps {
  getStore(): ServerTargetStore | null;
  sessionFetch: ServerRouteFetch;
  plainFetch: ServerRouteFetch;
  authenticateConnect(
    url: string,
    handle: string,
    isCurrent: () => boolean,
  ): Promise<ConnectRouteAuthentication>;
  startConnectRenewal(args: {
    expiresAt: number;
    remoteServerUrl: string;
  }): void;
  stopConnectRenewal(): void;
  onActiveRoute(url: string): void;
  retargetWindows(resolveUrl: (currentUrl: string) => string): Promise<void>;
  loadServerPage(url: string, isCurrent: () => boolean): Promise<boolean>;
  showUnreachable(args: { serverName: string; details: string }): Promise<void>;
  onRouteChange(change: BbDesktopServerRouteChange): void;
  onMenuChange(): void;
  logInfo(message: string): void;
  logWarning(message: string): void;
}

export interface RoutedServerController {
  current(): BbDesktopServerRoute | null;
  activeRoute(serverId: string): ServerRouteEntry | null;
  open(server: RoutedServer, isCurrent: () => boolean): Promise<void>;
  learn(
    advertised: AdvertisedServerRoutes | null,
    loadedUrl: string,
  ): Promise<void>;
  join(url: string, name: string | null): Promise<boolean>;
  setRoute(url: string | null): Promise<void>;
  check(): void;
  checkAfterActivation(): void;
  noteConnectSession(url: string, expiresAt: number): void;
  forgetConnectSession(url: string): void;
  stop(): void;
}

export function customServerRoute(url: string): ServerRouteEntry {
  return { url, kind: "custom", providerId: null, label: new URL(url).host };
}

export function connectServerRoute(url: string): ServerRouteEntry {
  return {
    url,
    kind: "relay",
    providerId: "connect",
    label: CONNECT_ROUTE_LABEL,
  };
}

function describeUnansweredRoutes(route: BbDesktopServerRoute): string {
  return route.routes
    .map(
      (option) =>
        `${option.label} (${new URL(option.url).host}): ${option.reason ?? "not tried"}`,
    )
    .join("; ");
}

export function createRoutedServerController(
  deps: RoutedServerControllerDeps,
): RoutedServerController {
  const connectSessionExpiries = new Map<string, number>();
  let session: RoutedServerSession | null = null;
  let lastActivationCheckAt = 0;

  function current(): BbDesktopServerRoute | null {
    return session?.snapshot() ?? null;
  }

  function stop(): void {
    if (session === null) return;
    session.stop();
    session = null;
    deps.onRouteChange({ route: null, switched: null });
  }

  async function ensureConnectSession(
    route: ServerRouteEntry,
    handle: string,
    signal: AbortSignal,
  ): Promise<RouteProbeOutcome> {
    const expiresAt = connectSessionExpiries.get(route.url);
    if (
      expiresAt !== undefined &&
      expiresAt - Date.now() > CONNECT_ROUTE_SESSION_MIN_REMAINING_MS
    ) {
      return { ok: true };
    }
    const result = await deps.authenticateConnect(
      route.url,
      handle,
      () => !signal.aborted,
    );
    if (!result.ok) {
      return {
        ok: false,
        reason: `bb connect sign-in failed (${result.code}: ${result.detail})`,
      };
    }
    connectSessionExpiries.set(route.url, result.expiresAt);
    return { ok: true };
  }

  async function probe(
    serverId: string,
    route: ServerRouteEntry,
    signal: AbortSignal,
  ): Promise<RouteProbeOutcome> {
    const handle = connectHandleForRoute(route);
    if (handle !== null) {
      const connectSession = await ensureConnectSession(route, handle, signal);
      if (!connectSession.ok) return connectSession;
    }
    const result = await probeServerRoute({
      url: route.url,
      headers: {},
      expectedServerId: serverId,
      fetchFn: deps.sessionFetch,
      signal,
    });
    if (result.kind === "answered") return { ok: true };
    if (result.kind === "different-server") {
      return {
        ok: false,
        reason: `a different bb server answered (${result.serverId ?? "no server id"})`,
      };
    }
    return { ok: false, reason: result.reason };
  }

  function startConnectRenewalFor(route: ServerRouteEntry): void {
    const expiresAt = connectSessionExpiries.get(route.url);
    if (connectHandleForRoute(route) === null || expiresAt === undefined) {
      deps.stopConnectRenewal();
      return;
    }
    deps.startConnectRenewal({ expiresAt, remoteServerUrl: route.url });
  }

  async function switchRoute(change: RouteSwitch): Promise<void> {
    startConnectRenewalFor(change.to);
    deps.onActiveRoute(change.to.url);
    try {
      await deps.retargetWindows((currentUrl) =>
        retargetedWindowUrl(
          currentUrl,
          change.from?.url ?? null,
          change.to.url,
        ),
      );
    } catch (error) {
      deps.logWarning(
        `[routes] could not open ${change.to.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      session?.check();
    }
    deps.onRouteChange({
      route: current(),
      switched: {
        fromLabel: change.from?.label ?? null,
        toLabel: change.to.label,
        reason: change.reason,
      },
    });
    deps.onMenuChange();
  }

  function startSession(server: RoutedServer): RoutedServerSession {
    session?.stop();
    const next = createRoutedServerSession({
      server,
      probe: (route, signal) => probe(server.serverId, route, signal),
      onSwitch: switchRoute,
      onState() {
        deps.onMenuChange();
        deps.onRouteChange({ route: current(), switched: null });
      },
      log: deps.logInfo,
    });
    session = next;
    return next;
  }

  async function foldSavedEntries(serverId: string): Promise<void> {
    const store = deps.getStore();
    if (store === null) return;
    const known = new Set(
      store
        .getRoutedServers()
        .flatMap((server) =>
          routedServerRoutes(server).map((route) => serverRouteKey(route.url)),
        ),
    );
    const answers = await Promise.all(
      store
        .getCustomServerUrls()
        .filter((url) => !known.has(serverRouteKey(url)))
        .map(async (url) => ({
          url,
          result: await probeServerRoute({
            url,
            headers: {},
            expectedServerId: serverId,
            fetchFn: deps.plainFetch,
            signal: new AbortController().signal,
          }),
        })),
    );
    let updated: RoutedServer | null = null;
    for (const { url, result } of answers) {
      if (result.kind !== "answered") continue;
      updated = await store.adoptRoutedServer({
        serverId,
        addedRoute: customServerRoute(url),
        advertisedRoutes: null,
        select: false,
      });
    }
    if (updated === null) return;
    if (session?.serverId === serverId) session.updateServer(updated);
    deps.onMenuChange();
  }

  return {
    current,
    activeRoute(serverId) {
      return session?.serverId === serverId ? session.activeRoute() : null;
    },
    async open(server, isCurrent) {
      const opening = startSession(server);
      const route = await opening.open();
      if (!isCurrent()) return;
      if (route === null) {
        const snapshot = opening.snapshot();
        stop();
        await deps.showUnreachable({
          serverName: snapshot.serverName,
          details: `${snapshot.serverName} did not answer on any route. ${describeUnansweredRoutes(snapshot)}.`,
        });
        return;
      }
      startConnectRenewalFor(route);
      const loaded = await deps.loadServerPage(route.url, isCurrent);
      if (!isCurrent()) return;
      if (!loaded) {
        deps.stopConnectRenewal();
        stop();
      }
    },
    async learn(advertised, loadedUrl) {
      const store = deps.getStore();
      if (store === null || advertised === null) return;
      const target = store.getTarget();
      if (target.kind === "server") {
        if (target.server.serverId !== advertised.serverId) {
          deps.logWarning(
            `[routes] ${loadedUrl} answered as ${advertised.serverId}, not ${target.server.serverId}; keeping the saved routes`,
          );
          return;
        }
        const updated = await store.setRoutedServerRoutes(
          advertised.serverId,
          advertised.routes,
        );
        if (updated !== null && session?.serverId === updated.serverId) {
          session.updateServer(updated);
        }
        deps.onMenuChange();
        await foldSavedEntries(advertised.serverId);
        return;
      }
      if (advertised.routes.length === 0) return;
      const addedRoute =
        target.kind === "connect"
          ? connectServerRoute(target.server.url)
          : target.kind === "custom"
            ? customServerRoute(target.url)
            : null;
      if (
        addedRoute === null ||
        serverRouteKey(addedRoute.url) !== serverRouteKey(loadedUrl)
      ) {
        return;
      }
      const server = await store.adoptRoutedServer({
        serverId: advertised.serverId,
        addedRoute,
        advertisedRoutes: advertised.routes,
        select: true,
      });
      deps.logInfo(
        `[routes] ${loadedUrl} is ${server.serverId}; reaching it over ${routedServerRoutes(server).length} routes`,
      );
      startSession(server).resume(loadedUrl);
      deps.onMenuChange();
      await foldSavedEntries(server.serverId);
    },
    async join(url, name) {
      const store = deps.getStore();
      if (store === null || store.getRoutedServers().length === 0) {
        return false;
      }
      const result = await probeServerRoute({
        url,
        headers: {},
        expectedServerId: null,
        fetchFn: deps.plainFetch,
        signal: new AbortController().signal,
      });
      if (
        result.kind !== "answered" ||
        result.serverId === null ||
        store.getRoutedServer(result.serverId) === null
      ) {
        return false;
      }
      await store.adoptRoutedServer({
        serverId: result.serverId,
        addedRoute: customServerRoute(url),
        advertisedRoutes: null,
        select: true,
      });
      if (name !== null) {
        await store.setRoutedServerName(result.serverId, name);
      }
      return true;
    },
    async setRoute(url) {
      const store = deps.getStore();
      const target = store?.getTarget();
      const active = session;
      if (
        store === null ||
        store === undefined ||
        target?.kind !== "server" ||
        active?.serverId !== target.server.serverId
      ) {
        return;
      }
      if (
        !(await store.setRoutedServerPinnedRoute(target.server.serverId, url))
      )
        return;
      await active.pin(url);
      deps.onMenuChange();
    },
    check() {
      session?.check();
    },
    checkAfterActivation() {
      const now = Date.now();
      if (now - lastActivationCheckAt < ROUTE_ACTIVATION_CHECK_INTERVAL_MS) {
        return;
      }
      lastActivationCheckAt = now;
      session?.check();
    },
    noteConnectSession(url, expiresAt) {
      connectSessionExpiries.set(url, expiresAt);
    },
    forgetConnectSession(url) {
      connectSessionExpiries.delete(url);
    },
    stop,
  };
}
