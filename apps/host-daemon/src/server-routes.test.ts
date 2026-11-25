import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDaemonServerRoutes } from "@bb/host-daemon-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import {
  ServerRouteResolver,
  persistServerRoutes,
  readPersistedServerRoutes,
} from "./server-routes.js";

const LAN = "http://192.168.1.5:38886";
const TAILNET = "https://studio.tail1234.ts.net";
const RELAY = "https://owner.getbb.app";
const SERVER_ID = "srv_test";

const SERVER_ROUTES: HostDaemonServerRoutes = {
  serverId: SERVER_ID,
  routes: [
    {
      providerId: "local-network",
      kind: "local-network",
      url: LAN,
      headers: {},
    },
    {
      providerId: "tailscale",
      kind: "private-overlay",
      url: TAILNET,
      headers: {},
    },
    {
      providerId: "connect",
      kind: "relay",
      url: RELAY,
      headers: { "x-bb-connect-machine": "bbcm_machine" },
    },
  ],
};

interface RouteBehavior {
  answer: boolean;
  delayMs?: number;
  serverId?: string;
}

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } satisfies HostDaemonLogger;
}

function createNetwork(initial: Record<string, RouteBehavior>) {
  const behavior = new Map(Object.entries(initial));
  const probes: string[] = [];
  const probeHeaders = new Map<string, unknown>();
  const fetchFn = vi.fn(async (input: URL, init: RequestInit) => {
    const origin = input.origin;
    probes.push(origin);
    probeHeaders.set(origin, init.headers);
    const route = behavior.get(origin) ?? { answer: false };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, route.delayMs ?? 0);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });
    if (!route.answer) throw new Error("connect ECONNREFUSED");
    return Response.json({ ok: true, serverId: route.serverId ?? SERVER_ID });
  });
  return {
    fetchFn,
    probes,
    probeHeaders,
    set(origin: string, next: RouteBehavior) {
      behavior.set(origin, next);
    },
  };
}

function createResolver(network: ReturnType<typeof createNetwork>) {
  const resolver = new ServerRouteResolver({
    anchorUrl: RELAY,
    anchorHeaders: { "x-bb-connect-machine": "bbcm_machine" },
    persisted: null,
    logger: createLogger(),
    fetchFn: network.fetchFn,
  });
  resolver.learn(SERVER_ROUTES);
  return resolver;
}

describe("ServerRouteResolver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the enrollment URL to its learned route and reports that route", () => {
    const resolver = createResolver(createNetwork({}));
    expect(resolver.active()).toEqual({
      url: RELAY,
      headers: { "x-bb-connect-machine": "bbcm_machine" },
      route: { providerId: "connect", kind: "relay" },
    });
    expect(resolver.candidates().map((route) => route.url)).toEqual([
      LAN,
      TAILNET,
      RELAY,
    ]);
  });

  it("ignores a route that answers as a different server", async () => {
    const network = createNetwork({
      [LAN]: { answer: true, serverId: "srv_other" },
      [new URL(RELAY).origin]: { answer: true },
    });
    const resolver = createResolver(network);
    const selected = resolver.select();
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await selected).route?.providerId).toBe("connect");
  });

  it("sends only the route's own headers on each probe", async () => {
    const network = createNetwork({
      [LAN]: { answer: false },
      [TAILNET]: { answer: false },
      [new URL(RELAY).origin]: { answer: true },
    });
    const resolver = createResolver(network);
    const selected = resolver.select();
    await vi.advanceTimersByTimeAsync(2_000);
    await selected;
    expect(network.probeHeaders.get(LAN)).toEqual({});
    expect(network.probeHeaders.get(TAILNET)).toEqual({});
    expect(network.probeHeaders.get(new URL(RELAY).origin)).toEqual({
      "x-bb-connect-machine": "bbcm_machine",
    });
  });

  async function settle<T>(work: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(4_000);
    return work;
  }

  it("fails over on the next dial and goes back to a better route as soon as it answers again", async () => {
    const network = createNetwork({
      [LAN]: { answer: true },
      [new URL(RELAY).origin]: { answer: true },
    });
    const resolver = createResolver(network);
    expect((await settle(resolver.select())).route?.kind).toBe("local-network");

    network.set(LAN, { answer: false });
    expect((await settle(resolver.select())).route?.kind).toBe("relay");

    network.set(LAN, { answer: true });
    expect((await settle(resolver.select())).route?.kind).toBe("local-network");
  });

  it("keeps the current route when no route answers", async () => {
    const network = createNetwork({ [LAN]: { answer: true } });
    const resolver = createResolver(network);
    expect((await settle(resolver.select())).url).toBe(LAN);

    network.set(LAN, { answer: false });
    expect((await settle(resolver.select())).url).toBe(LAN);
  });

  it("dials only the enrollment URL, without probing or saving, while the server advertises no routes", async () => {
    const network = createNetwork({});
    const persist = vi.fn(async () => undefined);
    const resolver = new ServerRouteResolver({
      anchorUrl: RELAY,
      anchorHeaders: { "x-bb-connect-machine": "bbcm_machine" },
      persisted: null,
      persist,
      logger: createLogger(),
      fetchFn: network.fetchFn,
    });
    resolver.learn({ serverId: SERVER_ID, routes: [] });
    expect(await resolver.select()).toEqual({
      url: RELAY,
      headers: { "x-bb-connect-machine": "bbcm_machine" },
      route: null,
    });
    expect(network.probes).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("forgets saved routes when the server stops advertising them", async () => {
    const network = createNetwork({});
    const persist = vi.fn(async () => undefined);
    const resolver = new ServerRouteResolver({
      anchorUrl: RELAY,
      anchorHeaders: {},
      persisted: { anchorUrl: RELAY, ...SERVER_ROUTES },
      persist,
      logger: createLogger(),
      fetchFn: network.fetchFn,
    });
    resolver.learn({ serverId: SERVER_ID, routes: [] });
    await resolver.flushPersistence();
    expect(persist).toHaveBeenCalledWith({
      anchorUrl: RELAY,
      serverId: SERVER_ID,
      routes: [],
    });
    expect(resolver.candidates().map((route) => route.url)).toEqual([RELAY]);
  });

  it("keeps attachment and update downloads on an encrypted route while on LAN", async () => {
    const network = createNetwork({ [LAN]: { answer: true } });
    const resolver = createResolver(network);
    const selected = resolver.select();
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await selected).url).toBe(LAN);
    expect(resolver.guardedDownloadTarget()).toEqual({
      url: TAILNET,
      headers: {},
      route: { providerId: "tailscale", kind: "private-overlay" },
    });
  });

  it("downloads over LAN only when the server offers no encrypted route", () => {
    const lanOnly = new ServerRouteResolver({
      anchorUrl: LAN,
      anchorHeaders: {},
      persisted: null,
      logger: createLogger(),
    });
    expect(lanOnly.guardedDownloadTarget()).toBeNull();
    lanOnly.learn({
      serverId: SERVER_ID,
      routes: [
        {
          providerId: "local-network",
          kind: "local-network",
          url: LAN,
          headers: {},
        },
      ],
    });
    expect(lanOnly.guardedDownloadTarget()?.url).toBe(LAN);
  });

  it("takes the connect gate from the relay route, not a ts.net enrollment URL", () => {
    const resolver = new ServerRouteResolver({
      anchorUrl: TAILNET,
      anchorHeaders: {},
      persisted: null,
      logger: createLogger(),
    });
    expect(resolver.connectGate()).toBeNull();
    resolver.learn(SERVER_ROUTES);
    expect(resolver.connectGate()).toEqual({
      serverUrl: RELAY,
      machineCredential: "bbcm_machine",
    });
  });
});

describe("persisted server routes", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-server-routes-test-"));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("saves learned routes outside config.json, reloads them on start, and deletes them when the server advertises none", async () => {
    const config = JSON.stringify({
      serverUrl: RELAY,
      serverHeaders: { "x-bb-connect-machine": "bbcm_machine" },
    });
    await writeFile(join(dataDir, "config.json"), config);
    const logger = createLogger();
    const first = new ServerRouteResolver({
      anchorUrl: RELAY,
      anchorHeaders: { "x-bb-connect-machine": "bbcm_machine" },
      persisted: await readPersistedServerRoutes(dataDir, logger),
      persist: persistServerRoutes(dataDir),
      logger,
    });
    first.learn(SERVER_ROUTES);
    await first.flushPersistence();

    expect(await readFile(join(dataDir, "config.json"), "utf8")).toBe(config);
    const restarted = new ServerRouteResolver({
      anchorUrl: RELAY,
      anchorHeaders: {},
      persisted: await readPersistedServerRoutes(dataDir, logger),
      persist: persistServerRoutes(dataDir),
      logger,
    });
    expect(restarted.candidates().map((route) => route.url)).toEqual([
      LAN,
      TAILNET,
      RELAY,
    ]);

    restarted.learn({ serverId: SERVER_ID, routes: [] });
    await restarted.flushPersistence();
    expect(await readPersistedServerRoutes(dataDir, logger)).toBeNull();
  });

  it("starts without saved routes when the routes file is unreadable", async () => {
    await writeFile(join(dataDir, "server-routes.json"), "{not json");
    const logger = createLogger();
    expect(await readPersistedServerRoutes(dataDir, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("ignores routes learned for a different enrollment URL", async () => {
    const resolver = new ServerRouteResolver({
      anchorUrl: "https://other.getbb.app",
      anchorHeaders: {},
      persisted: { anchorUrl: RELAY, ...SERVER_ROUTES },
      logger: createLogger(),
    });
    expect(resolver.candidates().map((route) => route.url)).toEqual([
      "https://other.getbb.app",
    ]);
  });
});
