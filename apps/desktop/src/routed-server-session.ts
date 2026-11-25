import type {
  BbDesktopServerRoute,
  BbDesktopServerRouteSwitch,
} from "@bb/desktop-contract";
import { selectServerRoute, serverRouteKey } from "@bb/server-routes";
import { routedServerName } from "./server-list.js";
import {
  routedServerRoutes,
  type RoutedServer,
  type ServerRouteEntry,
} from "./server-target.js";

export const ROUTE_HEARTBEAT_INTERVAL_MS = 10_000;
export const ROUTE_UNREACHABLE_RETRY_MS = 5_000;

export type RouteProbeOutcome = { ok: true } | { ok: false; reason: string };

export type RouteProbe = (
  route: ServerRouteEntry,
  signal: AbortSignal,
) => Promise<RouteProbeOutcome>;

export interface RouteSwitch {
  from: ServerRouteEntry | null;
  to: ServerRouteEntry;
  reason: BbDesktopServerRouteSwitch["reason"];
}

interface RouteHealth {
  answering: boolean;
  reason: string | null;
}

export interface RoutedServerSessionTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface CreateRoutedServerSessionArgs {
  server: RoutedServer;
  probe: RouteProbe;
  onSwitch(change: RouteSwitch): Promise<void>;
  onState(): void;
  log(message: string): void;
  timers?: RoutedServerSessionTimers;
}

export interface RoutedServerSession {
  readonly serverId: string;
  activeRoute(): ServerRouteEntry | null;
  open(): Promise<ServerRouteEntry | null>;
  resume(url: string): boolean;
  check(): void;
  pin(url: string | null): Promise<void>;
  updateServer(server: RoutedServer): void;
  snapshot(): BbDesktopServerRoute;
  stop(): void;
}

const systemTimers: RoutedServerSessionTimers = {
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return handle;
  },
  clearTimeout(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

export function createRoutedServerSession(
  args: CreateRoutedServerSessionArgs,
): RoutedServerSession {
  const timers = args.timers ?? systemTimers;
  const lifetime = new AbortController();
  const health = new Map<string, RouteHealth>();
  let server = args.server;
  let activeUrl: string | null = null;
  let status: BbDesktopServerRoute["status"] = "selecting";
  let timer: unknown = null;
  let queue: Promise<void> = Promise.resolve();

  function routes(): ServerRouteEntry[] {
    return routedServerRoutes(server);
  }

  function candidates(): ServerRouteEntry[] {
    const all = routes();
    const pinned = all.filter((route) => route.url === server.pinnedRouteUrl);
    return pinned.length === 0 ? all : pinned;
  }

  function activeRoute(): ServerRouteEntry | null {
    return routes().find((route) => route.url === activeUrl) ?? null;
  }

  function setStatus(next: BbDesktopServerRoute["status"]): void {
    if (status === next) return;
    status = next;
    args.onState();
  }

  async function probe(
    route: ServerRouteEntry,
    signal: AbortSignal,
  ): Promise<boolean> {
    const combined = AbortSignal.any([signal, lifetime.signal]);
    const outcome = await args.probe(route, combined);
    if (combined.aborted) return outcome.ok;
    const previous = health.get(route.url);
    const next: RouteHealth = outcome.ok
      ? { answering: true, reason: null }
      : { answering: false, reason: outcome.reason };
    health.set(route.url, next);
    if (
      previous?.answering !== next.answering ||
      previous.reason !== next.reason
    ) {
      args.onState();
    }
    return outcome.ok;
  }

  function select(): Promise<ServerRouteEntry | null> {
    return selectServerRoute(candidates(), probe);
  }

  function schedule(): void {
    if (lifetime.signal.aborted || activeUrl === null) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(
      () => {
        timer = null;
        check();
      },
      status === "connected"
        ? ROUTE_HEARTBEAT_INTERVAL_MS
        : ROUTE_UNREACHABLE_RETRY_MS,
    );
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = queue.then(async () => {
      if (lifetime.signal.aborted) return;
      await task();
      schedule();
    });
    queue = run.catch((error: unknown) => {
      args.log(
        `[routes] ${routedServerName(server)}: route check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      schedule();
    });
    return queue;
  }

  async function switchTo(
    winner: ServerRouteEntry,
    reason: RouteSwitch["reason"],
  ): Promise<void> {
    const from = activeRoute();
    activeUrl = winner.url;
    status = "connected";
    args.log(
      `[routes] ${routedServerName(server)}: ${from?.url ?? "none"} -> ${winner.url} (${reason})`,
    );
    args.onState();
    await args.onSwitch({ from, to: winner, reason });
  }

  async function settle(reason: RouteSwitch["reason"]): Promise<void> {
    const winner = await select();
    if (lifetime.signal.aborted) return;
    if (winner === null) {
      setStatus("unreachable");
      return;
    }
    if (winner.url === activeUrl) {
      setStatus("connected");
      return;
    }
    await switchTo(winner, reason);
  }

  async function heartbeat(): Promise<void> {
    const active = activeRoute();
    const stillCandidate =
      active !== null &&
      candidates().some((candidate) => candidate.url === active.url);
    if (stillCandidate) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await probe(active, lifetime.signal)) {
          setStatus("connected");
          return;
        }
        if (lifetime.signal.aborted) return;
      }
    }
    await settle(
      active !== null && !stillCandidate && server.pinnedRouteUrl !== null
        ? "pinned"
        : "unreachable",
    );
  }

  function check(): void {
    void enqueue(heartbeat);
  }

  return {
    serverId: server.serverId,
    activeRoute,
    async open() {
      let opened: ServerRouteEntry | null = null;
      await enqueue(async () => {
        status = "selecting";
        args.onState();
        opened = await select();
        if (lifetime.signal.aborted) return;
        activeUrl = opened?.url ?? null;
        status = opened === null ? "unreachable" : "connected";
        args.onState();
      });
      return opened;
    },
    resume(url) {
      const route = routes().find(
        (candidate) => serverRouteKey(candidate.url) === serverRouteKey(url),
      );
      if (route === undefined) return false;
      activeUrl = route.url;
      status = "connected";
      args.onState();
      schedule();
      return true;
    },
    check,
    pin(url) {
      return enqueue(async () => {
        server = { ...server, pinnedRouteUrl: url };
        args.onState();
        if (url !== null && url === activeUrl) return;
        await settle(url === null ? "automatic" : "pinned");
      });
    },
    updateServer(next) {
      server = next;
      args.onState();
      if (activeUrl !== null && activeRoute() === null) check();
    },
    snapshot() {
      return {
        serverId: server.serverId,
        serverName: routedServerName(server),
        status,
        activeUrl,
        pinnedUrl: server.pinnedRouteUrl,
        routes: routes().map((route) => ({
          url: route.url,
          kind: route.kind,
          label: route.label,
          answering: health.get(route.url)?.answering ?? null,
          reason: health.get(route.url)?.reason ?? null,
        })),
      };
    },
    stop() {
      lifetime.abort();
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

export function retargetedWindowUrl(
  currentUrl: string,
  fromRouteUrl: string | null,
  toRouteUrl: string,
): string {
  if (fromRouteUrl === null || !URL.canParse(currentUrl)) return toRouteUrl;
  const current = new URL(currentUrl);
  const from = new URL(fromRouteUrl);
  if (current.origin !== from.origin) return toRouteUrl;
  const fromPath = from.pathname.replace(/\/+$/u, "");
  const rest = current.pathname.startsWith(fromPath)
    ? current.pathname.slice(fromPath.length)
    : current.pathname;
  const next = new URL(toRouteUrl);
  next.pathname = `${next.pathname.replace(/\/+$/u, "")}${rest}`;
  next.search = current.search;
  next.hash = current.hash;
  return next.toString();
}
