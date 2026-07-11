import type { HostDaemonSessionOpenResponse } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import { ServerResponseError, type ServerClient } from "./server-client.js";
import type { ProtocolSelfUpdater } from "./protocol-self-update.js";
import { ServerConnection } from "./server-connection.js";
import type {
  CreateReconnectingWebSocket,
  ReconnectingWebSocketLike,
} from "./server-connection-support.js";

interface CreateServerClientFixtureArgs {
  heartbeatIntervalMs?: number;
  leaseTimeoutMs?: number;
  sessionIds?: string[];
  openSessionError?: Error;
}

interface CreateWebSocketFixtureArgs {
  autoReconnect?: boolean;
}

interface ConnectionFixtureArgs extends CreateServerClientFixtureArgs {
  autoReconnect?: boolean;
  connectMachineId?: string;
  machineCredential?: string;
  protocolSelfUpdater?: ProtocolSelfUpdater;
  onSelfUpdateInstalled?: () => void | Promise<void>;
  startupTimeoutMs?: number;
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
    if (args.openSessionError) {
      throw args.openSessionError;
    }
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
    fetchSkillTree: unused,
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
  const headers: Array<Record<string, string> | undefined> = [];
  const createWebSocket: CreateReconnectingWebSocket = (
    urlProvider,
    options,
  ) => {
    headers.push(options.headers);
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
        void openSocket().catch((error) => socket.onerror?.(error));
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
    void openSocket().catch((error) => socket.onerror?.(error));
    return socket;
  };

  return {
    createWebSocket,
    headers,
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
    ...(args.machineCredential !== undefined
      ? { machineCredential: args.machineCredential }
      : {}),
    ...(args.connectMachineId !== undefined
      ? { connectMachineId: args.connectMachineId }
      : {}),
    serverClient: serverClient.serverClient,
    serverUrl: "http://127.0.0.1:3334",
    protocolSelfUpdater: args.protocolSelfUpdater,
    onSelfUpdateInstalled: args.onSelfUpdateInstalled,
    startupTimeoutMs: args.startupTimeoutMs,
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
  it("runs protocol self-update handling only for protocol mismatch rejection", async () => {
    const handleProtocolMismatch = vi.fn(async () => "updated" as const);
    const onSelfUpdateInstalled = vi.fn();
    const protocolError = new ServerResponseError({
      action: "open session",
      bodyMessage: "protocol mismatch",
      code: "protocol_version_mismatch",
      retryable: false,
      status: 400,
      statusText: "Bad Request",
    });
    const { connection } = createConnectionFixture({
      openSessionError: protocolError,
      protocolSelfUpdater: { handleProtocolMismatch },
      onSelfUpdateInstalled,
    });

    void connection.start();
    await vi.waitFor(() => {
      expect(handleProtocolMismatch).toHaveBeenCalledOnce();
      expect(onSelfUpdateInstalled).toHaveBeenCalledOnce();
    });
    await connection.shutdown();
  });

  it("keeps retrying after a protocol update failure instead of timing out startup", async () => {
    vi.useFakeTimers();
    const handleProtocolMismatch = vi.fn(async () => "failed" as const);
    const protocolError = new ServerResponseError({
      action: "open session",
      bodyMessage: "protocol mismatch",
      code: "protocol_version_mismatch",
      retryable: false,
      status: 400,
      statusText: "Bad Request",
    });
    const { connection, webSocket } = createConnectionFixture({
      openSessionError: protocolError,
      protocolSelfUpdater: { handleProtocolMismatch },
      startupTimeoutMs: 100,
    });

    void connection.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(handleProtocolMismatch).toHaveBeenCalledOnce();
    expect(webSocket.sockets[0]?.close).not.toHaveBeenCalled();
    await connection.shutdown();
  });

  it("adds the machine credential to WS dial headers only when configured", async () => {
    const configured = createConnectionFixture({
      machineCredential: "bbcm_machine",
    });
    const plain = createConnectionFixture();
    try {
      await configured.connection.start();
      await plain.connection.start();
      expect(configured.webSocket.headers[0]).toEqual({
        authorization: "Bearer host-key-server-connection-test",
        "x-bb-connect-machine": "bbcm_machine",
      });
      expect(plain.webSocket.headers[0]).toEqual({
        authorization: "Bearer host-key-server-connection-test",
      });
    } finally {
      await configured.connection.shutdown();
      await plain.connection.shutdown();
    }
  });

  it("reports the connect machine id when opening a session", async () => {
    const fixture = createConnectionFixture({
      connectMachineId: "machine-cloud-1",
    });
    try {
      await fixture.connection.start();
      expect(fixture.openSession).toHaveBeenCalledWith(
        expect.objectContaining({ connectMachineId: "machine-cloud-1" }),
      );
    } finally {
      await fixture.connection.shutdown();
    }
  });

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
    const { connection, logger, setSession, webSocket } =
      createConnectionFixture({
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
