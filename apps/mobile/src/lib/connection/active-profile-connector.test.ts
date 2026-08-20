import type { DesktopSession } from "@bb/connect-client";
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectServerProfile,
  DirectServerProfile,
} from "../profiles/profile";
import type { AppStateLike, AppStateStatusLike } from "../realtime/app-state";
import { createFakeSocketFactory } from "../realtime/fake-socket";
import { createProfileClientRegistry } from "../sdk/client-registry";
import { createSessionScheduler } from "../session/session-scheduler";
import {
  AUTH_FAILURE_REFETCH_DELAY_MS,
  AUTH_FAILURE_VERIFY_DEBOUNCE_MS,
  CONNECT_FAILURE_VERIFY_INTERVAL_MS,
  createActiveProfileConnector,
} from "./active-profile-connector";

const direct: DirectServerProfile = {
  id: "d1",
  mode: "direct",
  serverUrl: "http://127.0.0.1:41999",
  label: "Simulator",
  createdAt: 0,
};

const connect: ConnectServerProfile = {
  id: "c1",
  mode: "connect",
  serverUrl: "https://bee.getbb.app",
  label: "bee",
  handle: "bee",
  credential: "bbcm_one",
  createdAt: 0,
};

function fakeAppState(): AppStateLike & {
  emit(state: AppStateStatusLike): void;
} {
  const handlers = new Set<(state: AppStateStatusLike) => void>();
  return {
    currentState: "active",
    addEventListener(_type, handler) {
      handlers.add(handler);
      return {
        remove: () => {
          handlers.delete(handler);
        },
      };
    },
    emit(state) {
      for (const handler of handlers) handler(state);
    },
  };
}

function setup() {
  const sockets = createFakeSocketFactory();
  const fetchResponses: Response[] = [];
  const registry = createProfileClientRegistry({
    sdk: {
      fetch: async () => {
        const next = fetchResponses.shift();
        if (!next) throw new TypeError("Network request failed");
        return next;
      },
      realtime: { socketFactory: sockets, onInvalidMessage: () => {} },
    },
  });
  const appState = fakeAppState();
  const fetchSession = vi.fn<() => Promise<DesktopSession>>();
  const schedulers: ReturnType<typeof createSessionScheduler>[] = [];
  const connector = createActiveProfileConnector({
    registry,
    appState,
    createSessionScheduler: () => {
      const scheduler = createSessionScheduler({
        cookieStore: { set: async () => true },
        fetchSession,
      });
      schedulers.push(scheduler);
      return scheduler;
    },
  });
  const changes: string[] = [];
  connector.subscribe(() => {
    const snap = connector.getSnapshot();
    changes.push(snap ? `${snap.profile.id}:${snap.session.status}` : "none");
  });
  return {
    sockets,
    registry,
    appState,
    fetchSession,
    fetchResponses,
    schedulers,
    connector,
  };
}

function sessionCookie(value: string): DesktopSession {
  return {
    cookie: {
      name: "bb_desktop_session",
      value,
      domain: ".getbb.app",
      expiresAt: Date.now() + 3_600_000,
    },
  };
}

async function flush(): Promise<void> {
  // Let the scheduler's start()/renewal promise chain settle.
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

/** Settle the verification chain (mint → cookie install → reconnect). */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("createActiveProfileConnector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the socket immediately for a direct profile and reuses the client on re-activation", () => {
    const { sockets, registry, connector } = setup();
    connector.activate(direct);
    expect(sockets.sockets).toHaveLength(1);
    const snap = connector.getSnapshot();
    expect(snap?.client).toBe(registry.peekClient(direct.id));
    expect(snap?.session).toEqual({ status: "idle" });

    // Same connection identity (label edit): no new socket, profile refreshed.
    connector.activate({ ...direct, label: "Renamed" });
    expect(sockets.sockets).toHaveLength(1);
    expect(connector.getSnapshot()?.profile.label).toBe("Renamed");
    expect(connector.getSnapshot()?.client).toBe(snap?.client);
  });

  it("tears the previous socket down when switching profiles and when deactivating", () => {
    const { sockets, connector } = setup();
    connector.activate(direct);
    const first = sockets.latest();
    first.open();

    connector.activate({ ...direct, id: "d2", serverUrl: "http://10.0.0.5:1" });
    expect(first.closes).toHaveLength(1);
    expect(sockets.sockets).toHaveLength(2);
    expect(sockets.latest().url).toBe("ws://10.0.0.5:1/ws");

    connector.activate(null);
    expect(sockets.latest().closes).toHaveLength(1);
    expect(connector.getSnapshot()).toBeNull();
  });

  it("suspends and resumes the live socket with AppState", () => {
    const { sockets, appState, connector } = setup();
    connector.activate(direct);
    sockets.latest().open();
    appState.emit("background");
    expect(sockets.latest().closes).toHaveLength(1);
    appState.emit("active");
    expect(sockets.sockets).toHaveLength(2);

    // After deactivation the AppState listener is gone: no socket resurrects.
    connector.activate(null);
    appState.emit("active");
    expect(sockets.sockets).toHaveLength(2);
  });

  it("opens the socket for a connect profile only once the session is installed", async () => {
    const { sockets, fetchSession, connector } = setup();
    let resolveSession: (session: DesktopSession) => void = () => {};
    fetchSession.mockImplementation(
      () =>
        new Promise<DesktopSession>((resolve) => {
          resolveSession = resolve;
        }),
    );
    connector.activate(connect);
    await flush();
    expect(connector.getSnapshot()?.session.status).toBe("authenticating");
    expect(sockets.sockets).toHaveLength(0);

    resolveSession({
      cookie: {
        name: "bb_desktop_session",
        value: "s",
        domain: ".getbb.app",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    await flush();
    expect(connector.getSnapshot()?.session.status).toBe("authenticated");
    expect(sockets.sockets).toHaveLength(1);
    expect(sockets.latest().url).toBe("wss://bee.getbb.app/ws");
  });

  it("closes the socket and stops when the credential is rejected, and rebuilds on a new credential", async () => {
    const { sockets, fetchSession, schedulers, connector } = setup();
    fetchSession.mockResolvedValueOnce({
      cookie: {
        name: "bb_desktop_session",
        value: "s",
        domain: ".getbb.app",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    connector.activate(connect);
    await flush();
    sockets.latest().open();

    // Renewal rejected: the gate says the machine is gone.
    fetchSession.mockRejectedValueOnce(
      Object.assign(new Error("unauthorized"), { status: 401 }),
    );
    await schedulers[0]?.renewNow();
    await flush();
    expect(connector.getSnapshot()?.session.status).toBe("auth-required");
    expect(sockets.latest().closes).toHaveLength(1);
    expect(sockets.sockets).toHaveLength(1);

    // Re-pairing stores a new credential: a fresh scheduler and socket.
    fetchSession.mockResolvedValueOnce({
      cookie: {
        name: "bb_desktop_session",
        value: "s2",
        domain: ".getbb.app",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    connector.activate({ ...connect, credential: "bbcm_two" });
    await flush();
    expect(schedulers).toHaveLength(2);
    expect(schedulers[0]?.getState()).toEqual({ status: "idle" });
    expect(connector.getSnapshot()?.session.status).toBe("authenticated");
    expect(sockets.sockets).toHaveLength(2);
  });

  it("re-mints the session when the gate refuses the /ws upgrade and reconnects at once; a refused re-mint ends in auth-required", async () => {
    const { sockets, fetchSession, connector } = setup();
    fetchSession.mockResolvedValueOnce(sessionCookie("s1"));
    connector.activate(connect);
    await flush();
    sockets.latest().open();
    expect(fetchSession).toHaveBeenCalledTimes(1);

    // The socket drops (stub/gate killed it); the next upgrade is refused
    // with a 401: the session is verified immediately and, once a fresh
    // cookie is installed, the socket reconnects without waiting out the
    // backoff.
    fetchSession.mockResolvedValueOnce(sessionCookie("s2"));
    vi.advanceTimersByTime(AUTH_FAILURE_VERIFY_DEBOUNCE_MS); // not a fresh mint
    sockets.latest().drop();
    vi.advanceTimersByTime(1000);
    expect(sockets.sockets).toHaveLength(2);
    sockets.latest().reject("Received bad response code from server 401");
    await settle();
    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(connector.getSnapshot()?.session.status).toBe("authenticated");
    expect(sockets.sockets).toHaveLength(3);
    sockets.latest().open();

    // Credential revoked in the dashboard: the re-mint is refused, the
    // socket is closed and nothing retries.
    fetchSession.mockRejectedValueOnce(
      Object.assign(new Error("unauthorized"), { status: 401 }),
    );
    sockets.latest().drop();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(2000); // past the auth-failure debounce
    sockets.latest().reject("Received bad response code from server 401");
    await settle();
    expect(connector.getSnapshot()?.session.status).toBe("auth-required");
    expect(fetchSession).toHaveBeenCalledTimes(3);
    // The pending reconnect was cancelled: no socket is opened again.
    vi.advanceTimersByTime(60_000);
    expect(sockets.sockets).toHaveLength(4);
  });

  it("verifies the session on a 401 from an API call and throttles plain connection failures", async () => {
    const { sockets, fetchSession, fetchResponses, connector, registry } =
      setup();
    fetchSession.mockResolvedValueOnce(sessionCookie("s1"));
    connector.activate(connect);
    await flush();
    sockets.latest().open();

    // A query hits the gate's HTML 401 (cookie gone): one verification.
    // (Past the debounce window, so the failure is not blamed on the mint.)
    vi.advanceTimersByTime(AUTH_FAILURE_VERIFY_DEBOUNCE_MS);
    fetchSession.mockResolvedValueOnce(sessionCookie("s2"));
    fetchResponses.push(
      new Response("<html>sign in</html>", {
        status: 401,
        headers: { "content-type": "text/html" },
      }),
    );
    const client = registry.peekClient(connect.id);
    await expect(client?.sdk.system.config()).rejects.toMatchObject({
      status: 401,
    });
    await settle();
    expect(fetchSession).toHaveBeenCalledTimes(2);
    // The socket was healthy: it is left alone.
    expect(sockets.sockets).toHaveLength(1);

    // Plain drops (no auth status): verified at most once per interval.
    fetchSession.mockResolvedValue(sessionCookie("s3"));
    vi.advanceTimersByTime(CONNECT_FAILURE_VERIFY_INTERVAL_MS);
    sockets.latest().drop();
    vi.advanceTimersByTime(1000);
    sockets.latest().drop(); // attempt 1 fails → verify
    await settle();
    expect(fetchSession).toHaveBeenCalledTimes(3);
    sockets.latest().drop(); // the immediate reconnect after the verify
    vi.advanceTimersByTime(1500);
    sockets.latest().drop(); // attempt 2 fails → throttled
    await settle();
    expect(fetchSession).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(CONNECT_FAILURE_VERIFY_INTERVAL_MS);
    sockets.latest().drop(); // past the interval → verify again
    await settle();
    expect(fetchSession).toHaveBeenCalledTimes(4);

    // Backgrounded: the suspend close is not a failed attempt.
    connector.activate(direct);
    expect(fetchSession).toHaveBeenCalledTimes(4);
  });

  it("refetches queries that raced the first mint once the cookie is installed, without minting again", async () => {
    const { sockets, fetchSession, fetchResponses, connector, registry } =
      setup();
    let resolveSession: (session: DesktopSession) => void = () => {};
    fetchSession.mockImplementation(
      () =>
        new Promise<DesktopSession>((resolve) => {
          resolveSession = resolve;
        }),
    );
    connector.activate(connect);
    await flush();
    const client = registry.peekClient(connect.id);
    if (!client) throw new Error("client missing");

    // The screen's first query goes out before the cookie exists and gets
    // the gate's sign-in page.
    fetchResponses.push(
      new Response("<html>sign in</html>", {
        status: 401,
        headers: { "content-type": "text/html" },
      }),
    );
    const observer = new QueryObserver(client.queryClient, {
      queryKey: ["system-config"],
      queryFn: () => client.sdk.system.config(),
    });
    const results: string[] = [];
    const unsubscribe = observer.subscribe((result) => {
      results.push(result.status);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().status).toBe("error");
    // The 401 coalesces with the first mint still in flight: no second call.
    expect(fetchSession).toHaveBeenCalledTimes(1);

    fetchResponses.push(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    resolveSession(sessionCookie("s1"));
    await flush();
    expect(connector.getSnapshot()?.session.status).toBe("authenticated");
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().status).toBe("success");
    expect(fetchSession).toHaveBeenCalledTimes(1);
    // One socket: the verification that coalesced with the mint must not
    // tear down the socket the mint just opened.
    expect(sockets.sockets).toHaveLength(1);
    unsubscribe();
  });

  it("blames a 401 right after a mint on the stale cookie: refetches instead of minting again", async () => {
    const { fetchSession, fetchResponses, connector, registry } = setup();
    fetchSession.mockResolvedValueOnce(sessionCookie("s1"));
    connector.activate(connect);
    await flush();
    const client = registry.peekClient(connect.id);
    if (!client) throw new Error("client missing");
    expect(fetchSession).toHaveBeenCalledTimes(1);

    // A request that was already in flight when the cookie landed comes
    // back 401 moments after the mint.
    fetchResponses.push(
      new Response("<html>sign in</html>", {
        status: 401,
        headers: { "content-type": "text/html" },
      }),
    );
    const observer = new QueryObserver(client.queryClient, {
      queryKey: ["system-config"],
      queryFn: () => client.sdk.system.config(),
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().status).toBe("error");
    expect(fetchSession).toHaveBeenCalledTimes(1);

    fetchResponses.push(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await vi.advanceTimersByTimeAsync(AUTH_FAILURE_REFETCH_DELAY_MS);
    expect(observer.getCurrentResult().status).toBe("success");
    expect(fetchSession).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores late session events from a profile the user already left", async () => {
    const { sockets, fetchSession, connector } = setup();
    let resolveSession: (session: DesktopSession) => void = () => {};
    fetchSession.mockImplementation(
      () =>
        new Promise<DesktopSession>((resolve) => {
          resolveSession = resolve;
        }),
    );
    connector.activate(connect);
    await flush();
    connector.activate(direct);
    expect(sockets.sockets).toHaveLength(1); // the direct socket

    resolveSession({
      cookie: {
        name: "bb_desktop_session",
        value: "s",
        domain: ".getbb.app",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    await flush();
    // The stopped scheduler's generation guard drops the result; no second
    // socket and the snapshot still belongs to the direct profile.
    expect(sockets.sockets).toHaveLength(1);
    expect(connector.getSnapshot()?.profile.id).toBe(direct.id);
    expect(connector.getSnapshot()?.session).toEqual({ status: "idle" });
  });
});
