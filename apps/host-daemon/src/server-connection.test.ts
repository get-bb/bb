import type { HostDaemonSessionOpenResponse } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import type { ServerClient } from "./server-client.js";
import { ServerConnection } from "./server-connection.js";
import type {
  CreateReconnectingWebSocket,
  ReconnectingWebSocketLike,
} from "./server-connection-support.js";

interface CreateServerClientFixtureArgs {
  heartbeatIntervalMs?: number;
  leaseTimeoutMs?: number;
  sessionIds?: string[];
}

interface CreateWebSocketFixtureArgs {
  autoReconnect?: boolean;
}

interface ConnectionFixtureArgs extends CreateServerClientFixtureArgs {
  autoReconnect?: boolean;
}

interface CreateSessionArgs {
  heartbeatIntervalMs: number;
  leaseTimeoutMs: number;
  sessionId: string;
}

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } satisfies HostDaemonLogger;
}

function createSession(args: CreateSessionArgs): HostDaemonSessionOpenResponse {
  return {
    heartbeatIntervalMs: args.heartbeatIntervalMs,
    leaseTimeoutMs: args.leaseTimeoutMs,
    retiredEnvironmentIds: [],
    sessionId: args.sessionId,
    watchSet: {
      generation: 0,
      threadStorageTargets: [],
      workspaceTargets: [],
    },
  };
}

function createServerClientFixture(args: CreateServerClientFixtureArgs = {}) {
  const sessionIds = args.sessionIds ?? ["session-1"];
  let sessionIndex = 0;
  const openSession = vi.fn(async () => {
    const sessionId = sessionIds[sessionIndex] ?? sessionIds.at(-1);
    sessionIndex += 1;
    if (!sessionId) {
      throw new Error("Expected at least one test session ID");
    }
    return createSession({
      heartbeatIntervalMs: args.heartbeatIntervalMs ?? 5_000,
      leaseTimeoutMs: args.leaseTimeoutMs ?? 30_000,
      sessionId,
    });
  });
  const unused = async () => {
    throw new Error("Unexpected server client call");
  };
  const serverClient = {
    openSession,
    fetchProjectAttachment: unused,
    postEvents: unused,
    callTool: unused,
    registerInteractiveRequest: unused,
    interruptInteractiveRequests: unused,
  } satisfies ServerClient;

  return {
    openSession,
    serverClient,
  };
}

function createWebSocketFixture(args: CreateWebSocketFixtureArgs = {}) {
  const sockets: ReconnectingWebSocketLike[] = [];
  const createWebSocket: CreateReconnectingWebSocket = (urlProvider) => {
    let readyState = 0;
    const socket: ReconnectingWebSocketLike = {
      get readyState() {
        return readyState;
      },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(() => {
        readyState = 3;
      }),
      reconnect: vi.fn(() => {
        if (args.autoReconnect === false) {
          return;
        }
        readyState = 3;
        socket.onclose?.({ code: 1000, reason: "test-reconnect" });
        void openSocket();
      }),
    };

    async function openSocket(): Promise<void> {
      await urlProvider();
      queueMicrotask(() => {
        readyState = 1;
        socket.onopen?.({ type: "open" });
      });
    }

    sockets.push(socket);
    void openSocket();
    return socket;
  };

  return {
    createWebSocket,
    sockets,
  };
}

function createConnectionFixture(args: ConnectionFixtureArgs = {}) {
  const logger = createLogger();
  const serverClient = createServerClientFixture(args);
  const webSocket = createWebSocketFixture({
    autoReconnect: args.autoReconnect,
  });
  const setSession = vi.fn();
  const connection = new ServerConnection({
    dataDir: "/tmp/bb-server-connection-test",
    hostId: "host-server-connection-test",
    hostKey: "host-key-server-connection-test",
    hostName: "Server Connection Test Host",
    hostType: "persistent",
    instanceId: "instance-server-connection-test",
    logger,
    serverClient: serverClient.serverClient,
    serverUrl: "http://127.0.0.1:3334",
    setSession,
    createWebSocket: webSocket.createWebSocket,
  });

  return {
    connection,
    logger,
    openSession: serverClient.openSession,
    setSession,
    webSocket,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ServerConnection", () => {
  it("logs delayed heartbeat timer ticks without logging normal heartbeats", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { connection, logger, webSocket } = createConnectionFixture({
      heartbeatIntervalMs: 5_000,
      leaseTimeoutMs: 30_000,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }

      await vi.advanceTimersByTimeAsync(5_000);
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "heartbeat" }),
      );
      expect(logger.warn).not.toHaveBeenCalled();

      vi.setSystemTime(25_000);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          heartbeatIntervalMs: 5_000,
          leaseTimeoutMs: 30_000,
          sessionId: "session-1",
          websocketReadyState: 1,
        }),
        "Host daemon heartbeat timer delayed",
      );
    } finally {
      await connection.shutdown();
    }
  });

  it("deduplicates inactive-session invalidation and reconnects only the current session", async () => {
    const { connection, logger, setSession, webSocket } = createConnectionFixture({
      autoReconnect: false,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }

      connection.handleSessionInvalidated({
        code: "inactive_session",
        observedSessionId: "stale-session",
        source: "postEvents",
      });
      expect(socket.reconnect).not.toHaveBeenCalled();

      connection.handleSessionInvalidated({
        code: "inactive_session",
        observedSessionId: "session-1",
        source: "postEvents",
      });
      connection.handleSessionInvalidated({
        code: "inactive_session",
        observedSessionId: "session-1",
        source: "postEvents",
      });

      expect(socket.reconnect).toHaveBeenCalledTimes(1);
      expect(socket.reconnect).toHaveBeenCalledWith(1000, "inactive-session");
      expect(setSession).toHaveBeenLastCalledWith(null);
      expect(logger.info).toHaveBeenCalledWith(
        {
          code: "inactive_session",
          sessionId: "session-1",
          source: "postEvents",
        },
        "Server reported inactive daemon session; reconnecting",
      );
    } finally {
      await connection.shutdown();
    }
  });
});
