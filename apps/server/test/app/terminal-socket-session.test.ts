import {
  createConnection,
  createEnvironment,
  createProject,
  createTerminalSession,
  createThread,
  ensurePersonalProject,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import type { ClientSocketSession } from "../../src/request-context.js";
import {
  createTerminalSocketProtocol,
  TERMINAL_SOCKET_INVALID_MESSAGE_REASON,
  TERMINAL_SOCKET_POLICY_CLOSE_REASON,
} from "../../src/ws/terminal-protocol.js";
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
    id: "host-terminal-session",
    name: "Terminal Session Host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "Standard",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/terminal-session-project",
    },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "test",
    status: "idle",
    environmentId: environment.id,
  });
  const terminal = createTerminalSession(db, {
    cols: 80,
    daemonSessionId: null,
    environmentId: environment.id,
    hostId: host.id,
    initialCwd: "/tmp",
    rows: 24,
    status: "disconnected",
    threadId: thread.id,
    title: "session-term",
  });
  return { host, project, environment, thread, terminal };
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

describe("terminal socket session manager", () => {
  it("authorizes before attach and is refused for missing/personal/host-path", async () => {
    const db = createTestDb();
    const { host, terminal } = seedStandard(db);
    const personal = ensurePersonalProject(db);
    const personalEnv = createEnvironment(db, noopNotifier, {
      projectId: personal.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const personalTerminal = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: personalEnv.id,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: null,
      title: "personal",
    });
    const hostPath = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: null,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: null,
      title: "host-path",
    });

    let authorizeCalls = 0;
    let releaseAuthorize!: (decision: { allowed: true }) => void;
    const authorizeGate = new Promise<{ allowed: true }>((resolve) => {
      releaseAuthorize = resolve;
    });
    const attachBrowserTerminal = vi.fn();
    const detachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal,
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
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
      terminal.id,
    );
    await flush();
    expect(authorizeCalls).toBe(1);
    expect(attachBrowserTerminal).not.toHaveBeenCalled();

    releaseAuthorize({ allowed: true });
    await flush();
    expect(attachBrowserTerminal).toHaveBeenCalledTimes(1);
    expect(attachBrowserTerminal).toHaveBeenCalledWith({
      sinceSeq: 0,
      socket,
      terminalId: terminal.id,
      threadId: null,
    });

    for (const deniedId of ["missing", personalTerminal.id, hostPath.id]) {
      const deniedSocket = createMockHubSocket();
      protocol.open(
        deniedSocket,
        scopedSession({ expiresAtMs: Date.now() + 60_000 }),
        deniedId,
      );
      await flush();
      expect(deniedSocket.closed).toEqual([
        { code: 1008, reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON },
      ]);
    }
    // Only the successful standard open attached.
    expect(attachBrowserTerminal).toHaveBeenCalledTimes(1);
  });

  it("close during hung authorize prevents later attach", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    let releaseAuthorize!: (decision: { allowed: true }) => void;
    const authorizeGate = new Promise<{ allowed: true }>((resolve) => {
      releaseAuthorize = resolve;
    });
    const attachBrowserTerminal = vi.fn();
    const detachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal,
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: Date.now() + 60_000,
        authorize: async () => authorizeGate,
      }),
      terminal.id,
    );
    await flush();
    protocol.close(socket);
    releaseAuthorize({ allowed: true });
    await flush();
    expect(attachBrowserTerminal).not.toHaveBeenCalled();
  });

  it("enforces exact expiry while open authorization is hung", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const clock = createFakeClock(10_000);
    const never = new Promise<{ allowed: true }>(() => undefined);
    const attachBrowserTerminal = vi.fn();
    const detachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal,
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
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
      terminal.id,
    );
    await flush();
    clock.advance(100);
    await flush();
    expect(socket.closed).toEqual([
      { code: 1008, reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(attachBrowserTerminal).not.toHaveBeenCalled();
  });

  it("authorize timeout closes without attach within 4s budget", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const clock = createFakeClock(1_000);
    const never = new Promise<{ allowed: true }>(() => undefined);
    const attachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal: vi.fn(),
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
      clock,
      membershipRecheckIntervalMs: 10_000,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: 1_000 + 60_000,
        authorize: async () => never,
      }),
      terminal.id,
    );
    await flush();
    clock.advance(4_000);
    await flush();
    expect(socket.closed).toEqual([
      { code: 1008, reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(attachBrowserTerminal).not.toHaveBeenCalled();
  });

  it("membership recheck closes and detaches after attach", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const clock = createFakeClock(5_000);
    let allow = true;
    const attachBrowserTerminal = vi.fn();
    const detachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal,
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
      clock,
      membershipRecheckIntervalMs: 100,
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: 5_000 + 60_000,
        authorize: async () =>
          allow
            ? { allowed: true as const }
            : { allowed: false as const, reason: "forbidden" },
      }),
      terminal.id,
    );
    await flush();
    expect(attachBrowserTerminal).toHaveBeenCalledTimes(1);

    allow = false;
    clock.advance(100);
    await flush();
    expect(socket.closed).toEqual([
      { code: 1008, reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(detachBrowserTerminal).toHaveBeenCalledWith({
      socket,
      terminalId: terminal.id,
    });
  });

  it("invalid message detaches after attach and closes 1008/invalid-message", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const attachBrowserTerminal = vi.fn();
    const detachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal,
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({ expiresAtMs: Date.now() + 60_000 }),
      terminal.id,
    );
    await flush();
    expect(attachBrowserTerminal).toHaveBeenCalledTimes(1);

    protocol.message(socket, "not-json");
    expect(socket.closed).toEqual([
      { code: 1008, reason: TERMINAL_SOCKET_INVALID_MESSAGE_REASON },
    ]);
    expect(detachBrowserTerminal).toHaveBeenCalledWith({
      socket,
      terminalId: terminal.id,
    });
  });

  it("refuses second Principal on the same socket and binds fixed terminal", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const attachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal: vi.fn(),
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({ expiresAtMs: Date.now() + 60_000 }),
      terminal.id,
    );
    await flush();
    protocol.open(
      socket,
      scopedSession({ expiresAtMs: Date.now() + 60_000 }),
      terminal.id,
    );
    expect(socket.closed).toContainEqual({
      code: 1008,
      reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON,
    });
  });

  it("queues valid early messages behind open authorization", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    let releaseAuthorize!: (decision: { allowed: true }) => void;
    const authorizeGate = new Promise<{ allowed: true }>((resolve) => {
      releaseAuthorize = resolve;
    });
    const handleBrowserTerminalMessage = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal: vi.fn(),
          detachBrowserTerminal: vi.fn(),
          handleBrowserTerminalMessage,
        } as never,
      },
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({
        expiresAtMs: Date.now() + 60_000,
        authorize: async () => authorizeGate,
      }),
      terminal.id,
    );
    protocol.message(socket, JSON.stringify({ type: "ping" }));
    await flush();
    expect(handleBrowserTerminalMessage).not.toHaveBeenCalled();

    releaseAuthorize({ allowed: true });
    await flush();
    expect(handleBrowserTerminalMessage).toHaveBeenCalledWith({
      message: { type: "ping" },
      socket,
      terminalId: terminal.id,
      threadId: null,
    });
  });

  it("membership recheck is independent of hung open authorization", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const clock = createFakeClock();
    const never = new Promise<{ allowed: true }>(() => undefined);
    const authorize = vi.fn(async (action: { name: string }) =>
      action.name === "terminalWs.reauthorize"
        ? { allowed: false as const, reason: "unauthenticated" as const }
        : never,
    );
    const attachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal: vi.fn(),
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
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
      terminal.id,
    );
    await flush();

    clock.advance(100);
    await flush();
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(socket.closed).toEqual([
      { code: 1008, reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON },
    ]);
    expect(attachBrowserTerminal).not.toHaveBeenCalled();
  });

  it("detaches and closes when attach partially fails", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const detachBrowserTerminal = vi.fn();
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal: vi.fn(() => {
            throw new Error("send failed after register");
          }),
          detachBrowserTerminal,
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
    });
    const socket = createMockHubSocket();
    protocol.open(
      socket,
      scopedSession({ expiresAtMs: Date.now() + 60_000 }),
      terminal.id,
    );
    await flush();

    expect(detachBrowserTerminal).toHaveBeenCalledWith({
      socket,
      terminalId: terminal.id,
    });
    expect(socket.closed).toEqual([
      { code: 1008, reason: "terminal_socket_error" },
    ]);
  });

  it("unrestricted local-owner attaches without authorize timers and preserves stock missing error", async () => {
    const db = createTestDb();
    const { terminal } = seedStandard(db);
    const clock = createFakeClock(1_000);
    const attachBrowserTerminal = vi.fn(
      (args: { terminalId: string; socket: { close: () => void } }) => {
        if (args.terminalId === "missing") {
          throw new ApiError(
            404,
            "terminal_not_found",
            "Terminal session not found",
          );
        }
      },
    );
    const protocol = createTerminalSocketProtocol({
      deps: {
        db,
        terminalSessions: {
          attachBrowserTerminal,
          detachBrowserTerminal: vi.fn(),
          handleBrowserTerminalMessage: vi.fn(),
        } as never,
      },
      clock,
      membershipRecheckIntervalMs: 50,
    });

    const okSocket = createMockHubSocket();
    protocol.open(okSocket, unrestrictedSession(), terminal.id);
    expect(attachBrowserTerminal).toHaveBeenCalledTimes(1);
    // No expiry/recheck timers for unrestricted.
    expect(clock.pendingCount()).toBe(0);

    const missingSocket = createMockHubSocket();
    protocol.open(missingSocket, unrestrictedSession(), "missing");
    expect(
      missingSocket.closed.some((c) => c.reason === "terminal_not_found"),
    ).toBe(true);
  });
});
