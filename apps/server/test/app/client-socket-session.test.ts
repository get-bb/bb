import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  ensurePersonalProject,
  migrate,
  noopNotifier,
  upsertHost,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientSocketSession } from "../../src/request-context.js";
import {
  CLIENT_SOCKET_INVALID_MESSAGE_REASON,
  CLIENT_SOCKET_POLICY_CLOSE_REASON,
  createClientSocketProtocol,
} from "../../src/ws/client-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

const openDatabases: DbConnection[] = [];

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()!.$client.close();
  }
});

function createTestDb(): DbConnection {
  const db = createConnection(":memory:");
  migrate(db);
  openDatabases.push(db);
  return db;
}

function seedStandard(db: DbConnection) {
  const host = upsertHost(db, noopNotifier, {
    id: "host-session",
    name: "Session Host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "Standard",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/session-project",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "test",
    status: "idle",
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  return { project, thread, environment };
}

type FakeTimer = {
  id: number;
  fireAt: number;
  callback: () => void;
};

function createFakeClock(startMs = 1_000_000) {
  let nowMs = startMs;
  let nextId = 1;
  const timers: FakeTimer[] = [];

  const clock = {
    now: () => nowMs,
    setTimeout(callback: () => void, delayMs: number) {
      const id = nextId++;
      timers.push({ id, fireAt: nowMs + delayMs, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle: ReturnType<typeof setTimeout>) {
      const id = handle as unknown as number;
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) {
        timers.splice(index, 1);
      }
    },
    advance(ms: number) {
      nowMs += ms;
      const due = timers
        .filter((timer) => timer.fireAt <= nowMs)
        .sort((a, b) => a.fireAt - b.fireAt);
      for (const timer of due) {
        const index = timers.indexOf(timer);
        if (index >= 0) {
          timers.splice(index, 1);
          timer.callback();
        }
      }
    },
    pendingCount() {
      return timers.length;
    },
  };
  return clock;
}

function scopedSession(args: {
  authorize?: ClientSocketSession["authorize"];
  expiresAtMs: number;
}): ClientSocketSession {
  return Object.freeze({
    principal: Object.freeze({
      id: "wt-user",
      kind: "human" as const,
      displayName: "WT User",
    }),
    expiresAtMs: args.expiresAtMs,
    clientRealtimeScope: "scoped",
    authorize: args.authorize ?? (async () => ({ allowed: true as const })),
  });
}

function unrestrictedSession(): ClientSocketSession {
  return Object.freeze({
    principal: Object.freeze({
      id: "local-owner",
      kind: "human" as const,
      displayName: "Local Owner",
    }),
    expiresAtMs: null,
    clientRealtimeScope: "unrestricted",
    authorize: async () => ({ allowed: true as const }),
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe("client socket session manager", () => {
  it("authorizes before hub/watch registration and is idempotent for duplicates", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    let authorizeCalls = 0;
    let releaseAuthorize!: (
      decision: { allowed: true } | { allowed: false; reason: "forbidden" },
    ) => void;
    const authorizeGate = new Promise<
      { allowed: true } | { allowed: false; reason: "forbidden" }
    >((resolve) => {
      releaseAuthorize = resolve;
    });
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
    });
    const socket = createMockHubSocket();
    const session = scopedSession({
      expiresAtMs: Date.now() + 60_000,
      authorize: async () => {
        authorizeCalls += 1;
        return authorizeGate;
      },
    });

    protocol.open(socket, session);
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();
    expect(authorizeCalls).toBe(1);
    expect(watchInterests.subscribe).not.toHaveBeenCalled();

    releaseAuthorize({ allowed: true });
    await flush();
    expect(watchInterests.subscribe).toHaveBeenCalledTimes(1);

    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();
    // Duplicate is idempotent: no second authorize or register.
    expect(authorizeCalls).toBe(1);
    expect(watchInterests.subscribe).toHaveBeenCalledTimes(1);

    hub.notifyThread(thread.id, ["events-appended"]);
    expect(socket.messages).toHaveLength(1);
  });

  it("treats forged unsubscribe as a no-op and never authorizes", async () => {
    const db = createTestDb();
    seedStandard(db);
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    const authorize = vi.fn(async () => ({ allowed: true as const }));
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({ expiresAtMs: Date.now() + 60_000, authorize }),
    );
    protocol.message(
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "thread-detail", threadId: "never-subscribed" },
      }),
    );
    await flush();
    expect(authorize).not.toHaveBeenCalled();
    expect(watchInterests.unsubscribe).not.toHaveBeenCalled();
    expect(socket.closed).toHaveLength(0);
  });

  it("close during in-flight authorize prevents registration", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    let releaseAuthorize!: (decision: { allowed: true }) => void;
    const authorizeGate = new Promise<{ allowed: true }>((resolve) => {
      releaseAuthorize = resolve;
    });
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: Date.now() + 60_000,
        authorize: async () => authorizeGate,
      }),
    );
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();
    protocol.close(socket);
    releaseAuthorize({ allowed: true });
    await flush();
    expect(watchInterests.subscribe).not.toHaveBeenCalled();
    expect(watchInterests.releaseSocket).toHaveBeenCalledWith(socket);
  });

  it("refuses to bind a second Principal to the same socket", () => {
    const db = createTestDb();
    const protocol = createClientSocketProtocol({
      hub: new NotificationHub(),
      watchInterests: {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        releaseSocket: vi.fn(),
      },
      db,
    });
    const socket = createMockHubSocket();
    protocol.open(socket, scopedSession({ expiresAtMs: Date.now() + 60_000 }));
    const replacement = Object.freeze({
      ...scopedSession({ expiresAtMs: Date.now() + 60_000 }),
      principal: Object.freeze({
        id: "different-user",
        kind: "human" as const,
        displayName: "Different User",
      }),
    });

    protocol.open(socket, replacement);
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
  });

  it("closes on exact expiry and does not reschedule after close", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const clock = createFakeClock(5_000);
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
      clock,
      membershipRecheckIntervalMs: 1_000,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: 5_000 + 2_500,
        authorize: async () => ({ allowed: true }),
      }),
    );
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();
    expect(watchInterests.subscribe).toHaveBeenCalledTimes(1);

    clock.advance(2_500);
    await flush();
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(watchInterests.releaseSocket).toHaveBeenCalled();
    const pendingAfterClose = clock.pendingCount();
    clock.advance(60_000);
    await flush();
    expect(clock.pendingCount()).toBe(pendingAfterClose);
  });

  it("enforces exact expiry while subscribe authorization is hung", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const clock = createFakeClock(10_000);
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    const never = new Promise<{ allowed: true }>(() => undefined);
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
      clock,
      membershipRecheckIntervalMs: 1_000,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: 10_100,
        authorize: async () => never,
      }),
    );
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();

    clock.advance(100);
    await flush();
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(watchInterests.subscribe).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("rechecks membership independently of a hung subscribe", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const clock = createFakeClock();
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    const never = new Promise<{ allowed: true }>(() => undefined);
    const authorize = vi.fn(async (action: { name: string }) =>
      action.name === "clientWs.reauthorize"
        ? { allowed: false as const, reason: "unauthenticated" as const }
        : never,
    );
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
      clock,
      membershipRecheckIntervalMs: 100,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: clock.now() + 60_000,
        authorize,
      }),
    );
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();

    clock.advance(100);
    await flush();
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(watchInterests.subscribe).not.toHaveBeenCalled();
  });

  it("releases delivery immediately on invalid input", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    const protocol = createClientSocketProtocol({ hub, watchInterests, db });
    const socket = createMockHubSocket();
    protocol.open(socket, scopedSession({ expiresAtMs: Date.now() + 60_000 }));
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();

    protocol.message(socket, "not-json");
    hub.notifyThread(thread.id, ["events-appended"]);
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_INVALID_MESSAGE_REASON },
    ]);
    expect(socket.messages).toHaveLength(0);
    expect(watchInterests.releaseSocket).toHaveBeenCalledWith(socket);
  });

  it("rolls back a partial subscription and fails closed", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(() => {
        throw new Error("watch registration failed");
      }),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    const protocol = createClientSocketProtocol({ hub, watchInterests, db });
    const socket = createMockHubSocket();
    protocol.open(socket, scopedSession({ expiresAtMs: Date.now() + 60_000 }));
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();

    hub.notifyThread(thread.id, ["events-appended"]);
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(socket.messages).toHaveLength(0);
    expect(watchInterests.releaseSocket).toHaveBeenCalledWith(socket);
  });

  it("recheck failure closes and cleans up; denial of list targets closes", async () => {
    const db = createTestDb();
    const { thread } = seedStandard(db);
    const clock = createFakeClock();
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    let allow = true;
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
      clock,
      membershipRecheckIntervalMs: 100,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: clock.now() + 60_000,
        authorize: async () =>
          allow
            ? { allowed: true }
            : { allowed: false, reason: "unauthenticated" },
      }),
    );
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await flush();

    allow = false;
    clock.advance(100);
    await flush();
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(watchInterests.releaseSocket).toHaveBeenCalled();
    hub.notifyThread(thread.id, ["events-appended"]);
    expect(socket.messages).toHaveLength(0);

    const listSocket = createMockHubSocket();
    const listProtocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
    });
    listProtocol.open(
      listSocket,
      scopedSession({
        expiresAtMs: Date.now() + 60_000,
        authorize: async () => ({ allowed: true }),
      }),
    );
    listProtocol.message(
      listSocket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-list" },
      }),
    );
    await flush();
    expect(listSocket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(watchInterests.subscribe).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid recheck config and keeps unrestricted without timers", async () => {
    const db = createTestDb();
    expect(() =>
      createClientSocketProtocol({
        hub: new NotificationHub(),
        watchInterests: {
          subscribe: vi.fn(),
          unsubscribe: vi.fn(),
          releaseSocket: vi.fn(),
        },
        db,
        membershipRecheckIntervalMs: 15_001,
      }),
    ).toThrow(/membershipRecheckIntervalMs/);

    const clock = createFakeClock();
    const protocol = createClientSocketProtocol({
      hub: new NotificationHub(),
      watchInterests: {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        releaseSocket: vi.fn(),
      },
      db,
      clock,
      membershipRecheckIntervalMs: 1_000,
    });
    const socket = createMockHubSocket();
    protocol.open(socket, unrestrictedSession());
    expect(clock.pendingCount()).toBe(0);
  });

  it("denies personal project targets for scoped sockets", async () => {
    const db = createTestDb();
    ensurePersonalProject(db);
    const personalThread = createThread(db, noopNotifier, {
      projectId: ensurePersonalProject(db).id,
      providerId: "test",
      status: "idle",
    });
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    const protocol = createClientSocketProtocol({
      hub: new NotificationHub(),
      watchInterests,
      db,
    });
    const socket = createMockHubSocket();
    protocol.open(socket, scopedSession({ expiresAtMs: Date.now() + 60_000 }));
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: personalThread.id },
      }),
    );
    await flush();
    expect(socket.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(watchInterests.subscribe).not.toHaveBeenCalled();
  });

  it("authorizes plugin-channel before hub registration and closes missing plugin", async () => {
    const db = createTestDb();
    upsertInstalledPlugin(db, {
      id: "linear",
      source: "path:/plugins/linear",
      provenance: { kind: "direct" },
      sourceIntent: { kind: "path", canonicalPath: "/plugins/linear" },
      exactResolution: { kind: "path" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/linear",
      version: "1.0.0",
      enabled: true,
    });
    const hub = new NotificationHub();
    const watchInterests = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseSocket: vi.fn(),
    };
    let authorizeCalls = 0;
    let releaseAuthorize!: (decision: { allowed: true }) => void;
    const authorizeGate = new Promise<{ allowed: true }>((resolve) => {
      releaseAuthorize = resolve;
    });
    const protocol = createClientSocketProtocol({
      hub,
      watchInterests,
      db,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: Date.now() + 60_000,
        authorize: async () => {
          authorizeCalls += 1;
          return authorizeGate;
        },
      }),
    );
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: {
          kind: "plugin-channel",
          pluginId: "linear",
          channel: "issues",
        },
      }),
    );
    await flush();
    expect(authorizeCalls).toBe(1);
    expect(watchInterests.subscribe).not.toHaveBeenCalled();
    releaseAuthorize({ allowed: true });
    await flush();
    expect(watchInterests.subscribe).toHaveBeenCalledTimes(1);

    hub.notifyPluginSignal("linear", "issues", { ok: true });
    expect(socket.messages).toHaveLength(1);
    hub.notifyPluginSignal("linear", "other", { ok: false });
    expect(socket.messages).toHaveLength(1);

    const missing = createMockHubSocket();
    protocol.open(missing, scopedSession({ expiresAtMs: Date.now() + 60_000 }));
    protocol.message(
      missing,
      JSON.stringify({
        type: "subscribe",
        target: {
          kind: "plugin-channel",
          pluginId: "missing",
          channel: "issues",
        },
      }),
    );
    await flush();
    expect(missing.closed).toEqual([
      { code: 1008, reason: CLIENT_SOCKET_POLICY_CLOSE_REASON },
    ]);
  });
});
