import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoutedServerSession,
  retargetedWindowUrl,
  ROUTE_HEARTBEAT_INTERVAL_MS,
  type RouteSwitch,
} from "../src/routed-server-session.js";
import type { RoutedServer } from "../src/server-target.js";

const MANUAL = "http://192.168.4.28:25900";
const LAN = "http://192.168.4.28:25837";
const RELAY = "https://owner.getbb.app";

const SERVER: RoutedServer = {
  serverId: "srv_dev",
  name: "Dev server",
  addedUrl: LAN,
  advertisedRoutes: [
    { url: MANUAL, kind: "custom", providerId: "direct", label: "Manual" },
    {
      url: LAN,
      kind: "local-network",
      providerId: "local-network",
      label: "Local network",
    },
    { url: RELAY, kind: "relay", providerId: "connect", label: "bb connect" },
  ],
  userRoutes: [
    { url: LAN, kind: "custom", providerId: null, label: "192.168.4.28" },
  ],
  pinnedRouteUrl: null,
};

function createHarness(server: RoutedServer = SERVER) {
  const answering = new Map<string, boolean>([
    [MANUAL, true],
    [LAN, true],
    [RELAY, true],
  ]);
  const switches: RouteSwitch[] = [];
  const session = createRoutedServerSession({
    server,
    async probe(route) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return answering.get(route.url) === true
        ? { ok: true }
        : { ok: false, reason: "connect ECONNREFUSED" };
    },
    async onSwitch(change) {
      switches.push(change);
    },
    onState: () => undefined,
    log: () => undefined,
  });
  return { answering, session, switches };
}

async function heartbeat(): Promise<void> {
  await vi.advanceTimersByTimeAsync(ROUTE_HEARTBEAT_INTERVAL_MS + 3_000);
}

describe("routed server session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens on the top route that answers", async () => {
    const { answering, session } = createHarness();
    answering.set(MANUAL, false);
    const opened = session.open();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await opened)?.url).toBe(LAN);
    expect(session.snapshot()).toMatchObject({
      status: "connected",
      activeUrl: LAN,
    });
    session.stop();
  });

  it("reports every route's reason when none answers at open", async () => {
    const { answering, session } = createHarness();
    for (const url of [MANUAL, LAN, RELAY]) answering.set(url, false);
    const opened = session.open();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await opened).toBeNull();
    expect(session.snapshot().routes.map((route) => route.reason)).toEqual([
      "connect ECONNREFUSED",
      "connect ECONNREFUSED",
      "connect ECONNREFUSED",
    ]);
    session.stop();
  });

  it("fails over when the active route stops answering and stays there when the better route comes back", async () => {
    const { answering, session, switches } = createHarness();
    const opened = session.open();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await opened)?.url).toBe(MANUAL);

    answering.set(MANUAL, false);
    await heartbeat();
    expect(switches).toEqual([
      {
        from: expect.objectContaining({ url: MANUAL }),
        to: expect.objectContaining({ url: LAN }),
        reason: "unreachable",
      },
    ]);

    answering.set(MANUAL, true);
    await heartbeat();
    await heartbeat();
    expect(switches).toHaveLength(1);
    expect(session.activeRoute()?.url).toBe(LAN);
    session.stop();
  });

  it("stays on the page while no route answers and resumes without switching when the same route returns", async () => {
    const { answering, session, switches } = createHarness();
    const opened = session.open();
    await vi.advanceTimersByTimeAsync(3_000);
    await opened;

    for (const url of [MANUAL, LAN, RELAY]) answering.set(url, false);
    await heartbeat();
    expect(session.snapshot().status).toBe("unreachable");

    answering.set(MANUAL, true);
    await heartbeat();
    expect(session.snapshot().status).toBe("connected");
    expect(switches).toEqual([]);
    session.stop();
  });

  it("uses only the pinned route and goes back to the best route when unpinned", async () => {
    const { answering, session, switches } = createHarness();
    const opened = session.open();
    await vi.advanceTimersByTimeAsync(3_000);
    await opened;

    const pinned = session.pin(RELAY);
    await vi.advanceTimersByTimeAsync(3_000);
    await pinned;
    expect(switches.at(-1)).toMatchObject({
      to: { url: RELAY },
      reason: "pinned",
    });

    answering.set(RELAY, false);
    await heartbeat();
    expect(session.activeRoute()?.url).toBe(RELAY);
    expect(session.snapshot().status).toBe("unreachable");

    const unpinned = session.pin(null);
    await vi.advanceTimersByTimeAsync(3_000);
    await unpinned;
    expect(switches.at(-1)).toMatchObject({
      from: { url: RELAY },
      to: { url: MANUAL },
      reason: "automatic",
    });
    session.stop();
  });
});

describe("retargetedWindowUrl", () => {
  it("keeps the thread path, query and hash on the new route", () => {
    expect(
      retargetedWindowUrl(
        `${MANUAL}/projects/proj_1/threads/thr_1?panel=diff#msg=4`,
        MANUAL,
        RELAY,
      ),
    ).toBe(`${RELAY}/projects/proj_1/threads/thr_1?panel=diff#msg=4`);
  });

  it("opens the new route's root when the window shows something else", () => {
    expect(
      retargetedWindowUrl("data:text/html,loading", MANUAL, `${LAN}/`),
    ).toBe(`${LAN}/`);
  });
});
