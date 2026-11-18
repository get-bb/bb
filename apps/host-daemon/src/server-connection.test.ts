import { Buffer } from "node:buffer";
import type { HostDaemonSessionOpenResponse } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import { ServerResponseError, type ServerClient } from "./server-client.js";
import type { ProtocolSelfUpdater } from "./protocol-self-update.js";
import { ServerConnection } from "./server-connection.js";
import type {
  CreateReconnectingWebSocket,
  ReconnectingWebSocketLike,
  ServerConnectionOptions,
  ServerMovedNotice,
} from "./server-connection-support.js";

interface CreateServerClientFixtureArgs {
  heartbeatIntervalMs?: number;
  leaseTimeoutMs?: number;
  reconnectGraceMs?: number;
  sessionIds?: string[];
  openSessionError?: Error;
}

interface CreateWebSocketFixtureArgs {
  autoReconnect?: boolean;
  rejectResume?: boolean;
}

interface ConnectionFixtureArgs extends CreateServerClientFixtureArgs {
  rejectResume?: boolean;
  onIdleProviderSessionTimeout?: (minutes: number) => void;
  onAgentCpuPriority?: (enabled: boolean) => void;
  autoReconnect?: boolean;
  serverHeaders?: Record<string, string>;
  protocolSelfUpdater?: ProtocolSelfUpdater;
  onSelfUpdateInstalled?: () => void | Promise<void>;
  onMachineShutdown?: () => void | Promise<void>;
  onInteractiveRequestsEnded?: ServerConnectionOptions["onInteractiveRequestsEnded"];
  onServerMoved?: (notice: ServerMovedNotice) => Promise<void>;
  onMachineEnvironment?: (
    environment: HostDaemonSessionOpenResponse["machineEnvironment"],
  ) => void;
  onHostRpcCancel?: ServerConnectionOptions["onHostRpcCancel"];
  startupTimeoutMs?: number;
}

interface CreateSessionArgs {
  heartbeatIntervalMs: number;
  leaseTimeoutMs: number;
  reconnectGraceMs: number;
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
    machineEnvironment: { revision: 0, entries: [] },
    idleProviderSessionTimeoutMinutes: 30,
    agentCpuPriority: true,
    leaseTimeoutMs: args.leaseTimeoutMs,
    reconnectGraceMs: args.reconnectGraceMs,
    retiredEnvironmentIds: [],
    endedInteractiveRequests: [],
    connectShares: { generation: 0, ports: [] },
    connectNext: { generation: 0, config: null },
    pluginHostGenerations: [],
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
      reconnectGraceMs: args.reconnectGraceMs ?? args.leaseTimeoutMs ?? 30_000,
      sessionId,
    });
  });
  const unused = async () => {
    throw new Error("Unexpected server client call");
  };
  const serverClient = {
    openSession,
    fetchProjectAttachment: unused,
    fetchSkillTreeManifest: unused,
    fetchSkillTreeContent: unused,
    fetchPluginHostArtifact: unused,
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

function parseSentFrames(socket: ReconnectingWebSocketLike): unknown[] {
  return vi
    .mocked(socket.send)
    .mock.calls.map(([frame]) => JSON.parse(frame) as unknown);
}

function createWebSocketFixture(args: CreateWebSocketFixtureArgs = {}) {
  const sockets: ReconnectingWebSocketLike[] = [];
  const bufferedAmounts = new Map<ReconnectingWebSocketLike, number>();
  const deliverers = new Map<
    ReconnectingWebSocketLike,
    (message: object, ack: number) => void
  >();
  const headers: Array<Record<string, string> | undefined> = [];
  const urls: string[] = [];
  const createWebSocket: CreateReconnectingWebSocket = (
    urlProvider,
    options,
  ) => {
    headers.push(options.headers);
    let readyState = 0;
    let serverSeq = 0;
    const socket: ReconnectingWebSocketLike = {
      get bufferedAmount() {
        return bufferedAmounts.get(socket) ?? 0;
      },
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
      reconnect: vi.fn((code?: number, reason?: string) => {
        if (args.autoReconnect === false) {
          return;
        }
        readyState = 3;
        socket.onclose?.({
          code: code ?? 1000,
          reason: reason ?? "test-reconnect",
        });
        void openSocket().catch((error) => socket.onerror?.(error));
      }),
    };

    async function openSocket(): Promise<void> {
      const url = await urlProvider();
      urls.push(url);
      const resuming = new URL(url).searchParams.has("resumeFrom");
      if (resuming && args.rejectResume) {
        queueMicrotask(() => {
          readyState = 3;
          socket.onclose?.({ code: 4409, reason: "resume-rejected" });
          void openSocket().catch((error) => socket.onerror?.(error));
        });
        return;
      }
      if (!resuming) {
        serverSeq = 0;
      }
      queueMicrotask(() => {
        readyState = 1;
        socket.onopen?.({ type: "open" });
      });
    }

    deliverers.set(socket, (message, ack) => {
      serverSeq += 1;
      socket.onmessage?.({
        data: JSON.stringify({ seq: serverSeq, ack, message }),
      });
    });
    bufferedAmounts.set(socket, 0);
    sockets.push(socket);
    void openSocket().catch((error) => socket.onerror?.(error));
    return socket;
  };

  return {
    createWebSocket,
    deliver(socket: ReconnectingWebSocketLike, message: object, ack = 0) {
      deliverers.get(socket)?.(message, ack);
    },
    headers,
    sentMessages(socket: ReconnectingWebSocketLike): unknown[] {
      return parseSentFrames(socket).flatMap((frame) =>
        typeof frame === "object" && frame !== null && "message" in frame
          ? [frame.message]
          : [],
      );
    },
    setBufferedAmount(socket: ReconnectingWebSocketLike, bytes: number) {
      bufferedAmounts.set(socket, bytes);
    },
    sockets,
    urls,
  };
}

function createConnectionFixture(args: ConnectionFixtureArgs = {}) {
  const logger = createLogger();
  const serverClient = createServerClientFixture(args);
  const webSocket = createWebSocketFixture({
    autoReconnect: args.autoReconnect,
    rejectResume: args.rejectResume,
  });
  const setSession = vi.fn();
  const connection = new ServerConnection({
    dataDir: "/tmp/bb-server-connection-test",
    hostId: "host-server-connection-test",
    hostKey: "host-key-server-connection-test",
    hostName: "Server Connection Test Host",
    instanceId: "instance-server-connection-test",
    localApiPort: 38_887,
    logger,
    ...(args.serverHeaders !== undefined
      ? { serverHeaders: args.serverHeaders }
      : {}),
    serverClient: serverClient.serverClient,
    serverUrl: "http://127.0.0.1:3334",
    protocolSelfUpdater: args.protocolSelfUpdater,
    onSelfUpdateInstalled: args.onSelfUpdateInstalled,
    onMachineShutdown: args.onMachineShutdown,
    onInteractiveRequestsEnded: args.onInteractiveRequestsEnded,
    onServerMoved: args.onServerMoved,
    onMachineEnvironment: args.onMachineEnvironment,
    onIdleProviderSessionTimeout: args.onIdleProviderSessionTimeout,
    onAgentCpuPriority: args.onAgentCpuPriority,
    onHostRpcCancel: args.onHostRpcCancel,
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
  it("resumes the same session for three hosts after a 32 s server acknowledgement blackout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fixtures = Array.from({ length: 3 }, () =>
      createConnectionFixture({
        heartbeatIntervalMs: 5_000,
        leaseTimeoutMs: 30_000,
      }),
    );
    try {
      for (const fixture of fixtures) {
        await fixture.connection.start();
        const socket = fixture.webSocket.sockets[0];
        if (!socket) throw new Error("Expected test socket");
        fixture.webSocket.deliver(socket, { type: "heartbeat-ack" });
      }

      await vi.advanceTimersByTimeAsync(4_999 + 32_000);

      for (const fixture of fixtures) {
        const socket = fixture.webSocket.sockets[0];
        if (!socket) throw new Error("Expected test socket");
        expect(socket.reconnect).toHaveBeenCalledWith(
          1013,
          "heartbeat-ack-timeout",
        );
        expect(fixture.openSession).toHaveBeenCalledTimes(1);
        expect(fixture.setSession).not.toHaveBeenCalledWith(null);
        expect(fixture.connection.sessionId).toBe("session-1");
        expect(fixture.webSocket.urls.at(-1)).toContain("resumeFrom=1");
        const heartbeats = fixture.webSocket
          .sentMessages(socket)
          .filter(
            (message) => JSON.stringify(message) === '{"type":"heartbeat"}',
          );
        expect(heartbeats.length).toBeGreaterThan(6);

        fixture.webSocket.deliver(socket, { type: "heartbeat-ack" });
      }
      await vi.advanceTimersByTimeAsync(25_000);
      for (const fixture of fixtures) {
        expect(fixture.webSocket.sockets[0]?.reconnect).toHaveBeenCalledTimes(
          1,
        );
      }
    } finally {
      for (const fixture of fixtures) await fixture.connection.shutdown();
    }
  });

  it("opens a new session instead of resuming when the server offers no reconnect grace", async () => {
    const { connection, openSession, setSession, webSocket } =
      createConnectionFixture({
        reconnectGraceMs: 0,
        sessionIds: ["first", "second"],
      });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");

      socket.reconnect();
      await vi.waitFor(() => expect(connection.sessionId).toBe("second"));
      expect(openSession).toHaveBeenCalledTimes(2);
      expect(setSession).toHaveBeenCalledWith(null);
      expect(webSocket.urls.some((url) => url.includes("resumeFrom"))).toBe(
        false,
      );
    } finally {
      await connection.shutdown();
    }
  });

  it("ignores server messages replayed after a resume", async () => {
    const onHostRpcCancel = vi.fn();
    const { connection, webSocket } = createConnectionFixture({
      onHostRpcCancel,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");
      const frame = JSON.stringify({
        seq: 1,
        ack: 0,
        message: { type: "host-rpc.cancel", requestId: "rpc-1" },
      });
      socket.onmessage?.({ data: frame });
      socket.onmessage?.({ data: frame });
      expect(onHostRpcCancel).toHaveBeenCalledTimes(1);
    } finally {
      await connection.shutdown();
    }
  });

  it("re-sends an unacknowledged recoverable message in the next session but not an acknowledged one", async () => {
    const { connection, webSocket } = createConnectionFixture({
      sessionIds: ["first", "second"],
      rejectResume: true,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");
      const identity = {
        type: "connect-tunnel.identity" as const,
        identity: { label: "laptop", baseDomain: "getbb.app" },
      };
      const exited = {
        type: "terminal.exited" as const,
        terminalId: "term-1",
        exitCode: 0,
        closeReason: "process-exit" as const,
      };
      connection.sendMessage(identity);
      webSocket.deliver(socket, { type: "heartbeat-ack" }, 1);
      connection.sendMessage(exited);
      vi.mocked(socket.send).mockClear();

      socket.reconnect();
      await vi.waitFor(() => expect(connection.sessionId).toBe("second"));
      await vi.waitFor(() =>
        expect(webSocket.sentMessages(socket)).toEqual([exited]),
      );
    } finally {
      await connection.shutdown();
    }
  });

  it("ends the session locally when it cannot resume within the grace period", async () => {
    vi.useFakeTimers();
    const { connection, setSession, webSocket } = createConnectionFixture({
      autoReconnect: false,
      leaseTimeoutMs: 30_000,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");

      socket.onclose?.({ code: 1001, reason: "tunnel disconnected" });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(connection.sessionId).toBe("session-1");
      expect(setSession).not.toHaveBeenCalledWith(null);

      await vi.advanceTimersByTimeAsync(1);
      expect(connection.sessionId).toBeNull();
      expect(setSession).toHaveBeenLastCalledWith(null);
    } finally {
      await connection.shutdown();
    }
  });

  it("tells the server it is shutting down so the session ends at once", async () => {
    const { connection, webSocket } = createConnectionFixture();
    await connection.start();
    const socket = webSocket.sockets[0];
    if (!socket) throw new Error("Expected test socket");
    await connection.shutdown();
    expect(socket.close).toHaveBeenCalledWith(1000, "daemon-shutdown");
  });

  it("applies the idle timeout on connection, live changes and reconnect", async () => {
    const onIdleProviderSessionTimeout = vi.fn();
    const { connection, webSocket } = createConnectionFixture({
      onIdleProviderSessionTimeout,
      sessionIds: ["first", "second"],
      rejectResume: true,
    });
    try {
      await connection.start();
      expect(onIdleProviderSessionTimeout).toHaveBeenLastCalledWith(30);
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");
      for (const minutes of [5, 0, 60]) {
        webSocket.deliver(socket, {
          type: "provider-session-policy.replace",
          idleProviderSessionTimeoutMinutes: minutes,
          agentCpuPriority: true,
        });
        expect(onIdleProviderSessionTimeout).toHaveBeenLastCalledWith(minutes);
      }
      socket.reconnect();
      await vi.waitFor(() => expect(connection.sessionId).toBe("second"));
      expect(onIdleProviderSessionTimeout).toHaveBeenLastCalledWith(30);
    } finally {
      await connection.shutdown();
    }
  });

  it("applies the agent CPU priority from the handshake, live changes and reconnect, and ignores policies without it", async () => {
    const onAgentCpuPriority = vi.fn();
    const { connection, webSocket } = createConnectionFixture({
      onAgentCpuPriority,
      sessionIds: ["first", "second"],
      rejectResume: true,
    });
    try {
      await connection.start();
      expect(onAgentCpuPriority).toHaveBeenLastCalledWith(true);
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");
      webSocket.deliver(socket, {
        type: "provider-session-policy.replace",
        idleProviderSessionTimeoutMinutes: 30,
        agentCpuPriority: false,
      });
      expect(onAgentCpuPriority).toHaveBeenLastCalledWith(false);
      onAgentCpuPriority.mockClear();
      webSocket.deliver(socket, {
        type: "provider-session-policy.replace",
        idleProviderSessionTimeoutMinutes: 30,
      });
      expect(onAgentCpuPriority).not.toHaveBeenCalled();
      socket.reconnect();
      await vi.waitFor(() => expect(connection.sessionId).toBe("second"));
      expect(onAgentCpuPriority).toHaveBeenLastCalledWith(true);
    } finally {
      await connection.shutdown();
    }
  });

  it("applies initial and replacement machine environments, ignores stale updates and resets revisions after reconnect", async () => {
    const onMachineEnvironment = vi.fn();
    const { connection, webSocket } = createConnectionFixture({
      onMachineEnvironment,
      sessionIds: ["first", "second"],
      rejectResume: true,
    });
    try {
      await connection.start();
      expect(onMachineEnvironment).toHaveBeenLastCalledWith({
        revision: 0,
        entries: [],
      });
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");
      const send = (revision: number) =>
        webSocket.deliver(socket, {
          type: "machine-environment.replace",
          environment: { revision, entries: [] },
        });
      send(3);
      send(2);
      expect(onMachineEnvironment).toHaveBeenCalledTimes(2);
      expect(onMachineEnvironment).toHaveBeenLastCalledWith({
        revision: 3,
        entries: [],
      });
      socket.reconnect();
      await vi.waitFor(() => expect(connection.sessionId).toBe("second"));
      send(1);
      expect(onMachineEnvironment).toHaveBeenLastCalledWith({
        revision: 1,
        entries: [],
      });
    } finally {
      await connection.shutdown();
    }
  });

  it("dispatches the machine shutdown command", async () => {
    const onMachineShutdown = vi.fn(async () => undefined);
    const { connection, webSocket } = createConnectionFixture({
      onMachineShutdown,
    });
    await connection.start();
    const socket = webSocket.sockets[0];
    if (!socket) throw new Error("Expected test socket");

    webSocket.deliver(socket, {
      type: "machine.shutdown",
    });

    await vi.waitFor(() => {
      expect(onMachineShutdown).toHaveBeenCalledOnce();
    });
    await connection.shutdown();
  });

  it("hands ended provider questions to the registry", async () => {
    const onInteractiveRequestsEnded = vi.fn();
    const { connection, webSocket } = createConnectionFixture({
      onInteractiveRequestsEnded,
    });
    await connection.start();
    const socket = webSocket.sockets[0];
    if (!socket) throw new Error("Expected test socket");
    const request = {
      threadId: "thr_ended",
      providerId: "claude-code",
      providerThreadId: "provider-thr-ended",
      providerRequestId: "request-ended",
    };

    webSocket.deliver(socket, {
      type: "interactive-requests.end",
      requests: [request],
      reason: "closed on the server",
    });

    await vi.waitFor(() => {
      expect(onInteractiveRequestsEnded).toHaveBeenCalledWith({
        reason: "closed on the server",
        requests: [request],
      });
    });
    await connection.shutdown();
  });

  it("hands a server.moved message to the move handler", async () => {
    const onServerMoved = vi.fn(async () => undefined);
    const { connection, webSocket } = createConnectionFixture({
      onServerMoved,
    });
    await connection.start();
    const socket = webSocket.sockets[0];
    if (!socket) throw new Error("Expected test socket");

    webSocket.deliver(socket, {
      type: "server.moved",
      serverUrl: "https://new-server.example.test",
      headers: { "x-bb-connect-machine": "bbcm_new" },
    });

    await vi.waitFor(() => {
      expect(onServerMoved).toHaveBeenCalledWith({
        serverUrl: "https://new-server.example.test",
        headers: { "x-bb-connect-machine": "bbcm_new" },
        source: "message",
      });
    });
    await connection.shutdown();
  });

  it("switches servers instead of failing startup when session open answers 410 server_moved", async () => {
    const onServerMoved = vi.fn(async () => undefined);
    const movedError = new ServerResponseError({
      action: "open session",
      bodyMessage: "This bb server moved to studio",
      code: "server_moved",
      retryable: false,
      serverMoved: {
        serverUrl: "http://studio.local:38886",
        toHostName: "studio",
        movedAt: 1_700_000_000_000,
      },
      status: 410,
      statusText: "Gone",
    });
    const { connection, logger, webSocket } = createConnectionFixture({
      onServerMoved,
      openSessionError: movedError,
    });

    const started = connection.start();
    started.catch(() => undefined);
    await vi.waitFor(() => {
      expect(onServerMoved).toHaveBeenCalledWith({
        source: "session-open",
        serverUrl: "http://studio.local:38886",
        headers: null,
        toHostName: "studio",
        movedAt: 1_700_000_000_000,
      });
      expect(logger.info).toHaveBeenCalledWith(
        { serverUrl: "http://127.0.0.1:3334" },
        "Waiting for server...",
      );
    });

    expect(webSocket.sockets[0]?.close).not.toHaveBeenCalled();
    await connection.shutdown();
  });

  it("fails startup on 410 server_moved when switching servers fails", async () => {
    const onServerMoved = vi.fn(async () => {
      throw new Error("config.json is invalid");
    });
    const movedError = new ServerResponseError({
      action: "open session",
      bodyMessage: "This bb server moved to studio",
      code: "server_moved",
      retryable: false,
      serverMoved: {
        serverUrl: "http://studio.local:38886",
        toHostName: "studio",
        movedAt: 1_700_000_000_000,
      },
      status: 410,
      statusText: "Gone",
    });
    const { connection } = createConnectionFixture({
      onServerMoved,
      openSessionError: movedError,
    });

    await expect(connection.start()).rejects.toBe(movedError);
    expect(onServerMoved).toHaveBeenCalledOnce();
  });

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
      expect(handleProtocolMismatch).toHaveBeenCalledWith({ force: false });
      expect(onSelfUpdateInstalled).toHaveBeenCalledOnce();
    });
    await connection.shutdown();
  });

  it("forces a self-update attempt when the server accepted a user retry", async () => {
    const handleProtocolMismatch = vi.fn(async () => "failed" as const);
    const protocolError = new ServerResponseError({
      action: "open session",
      bodyMessage: "protocol mismatch",
      code: "protocol_version_mismatch",
      protocolUpdateRetryRequested: true,
      retryable: false,
      status: 400,
      statusText: "Bad Request",
    });
    const { connection } = createConnectionFixture({
      openSessionError: protocolError,
      protocolSelfUpdater: { handleProtocolMismatch },
    });

    void connection.start();
    await vi.waitFor(() => {
      expect(handleProtocolMismatch).toHaveBeenCalledWith({ force: true });
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
      serverHeaders: {
        "x-bb-connect-machine": "bbcm_machine",
        "x-test-access": "opaque",
      },
    });
    const plain = createConnectionFixture();
    try {
      await configured.connection.start();
      await plain.connection.start();
      expect(configured.webSocket.headers[0]).toEqual({
        authorization: "Bearer host-key-server-connection-test",
        "x-bb-connect-machine": "bbcm_machine",
        "x-test-access": "opaque",
      });
      expect(plain.webSocket.headers[0]).toEqual({
        authorization: "Bearer host-key-server-connection-test",
      });
    } finally {
      await configured.connection.shutdown();
      await plain.connection.shutdown();
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
      expect(webSocket.sentMessages(socket)).toContainEqual({
        type: "heartbeat",
      });
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

  it("reports a system-suspension gap without calling it a heartbeat stall", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { connection, logger, webSocket } = createConnectionFixture({
      heartbeatIntervalMs: 5_000,
      leaseTimeoutMs: 30_000,
    });
    try {
      await connection.start();
      await vi.advanceTimersByTimeAsync(5_000);

      vi.setSystemTime(300_000);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        "Host daemon heartbeat timer delayed",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ gapMs: 300_000 }),
        "Host daemon resumed after likely system suspension",
      );
      expect(webSocket.sockets[0]?.reconnect).not.toHaveBeenCalled();
    } finally {
      await connection.shutdown();
    }
  });

  it("grants a fresh acknowledgement lease after a shorter heartbeat delay", async () => {
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
      vi.setSystemTime(35_000);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ gapMs: 35_000 }),
        "Host daemon heartbeat timer delayed",
      );
      expect(socket.reconnect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(socket.reconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(socket.reconnect).toHaveBeenCalledWith(
        1013,
        "heartbeat-ack-timeout",
      );
    } finally {
      await connection.shutdown();
    }
  });

  it("reconnects when server heartbeat acknowledgements stop", async () => {
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

      await vi.advanceTimersByTimeAsync(25_000);
      webSocket.deliver(socket, { type: "heartbeat-ack" });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(socket.reconnect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(socket.reconnect).toHaveBeenCalledWith(
        1013,
        "heartbeat-ack-timeout",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          lastAcknowledgedAt: 25_000,
          leaseTimeoutMs: 30_000,
          sessionId: "session-1",
        }),
        "Server heartbeat acknowledgements stopped; reconnecting",
      );
    } finally {
      await connection.shutdown();
    }
  });

  it("queues output above high water and flushes it before lifecycle messages", async () => {
    vi.useFakeTimers();
    const { connection, webSocket } = createConnectionFixture();
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }
      webSocket.setBufferedAmount(socket, 2 * 1024 * 1024);
      const output = {
        type: "terminal.output" as const,
        terminalId: "term-1",
        chunk: {
          seq: 0,
          dataBase64: Buffer.from("hello").toString("base64"),
        },
      };
      const exited = {
        type: "terminal.exited" as const,
        terminalId: "term-1",
        exitCode: 0,
        closeReason: "user" as const,
      };

      expect(connection.sendMessage(output)).toBe(true);
      expect(socket.send).not.toHaveBeenCalled();

      expect(connection.sendMessage(exited)).toBe(true);
      expect(webSocket.sentMessages(socket)).toEqual([output, exited]);
    } finally {
      await connection.shutdown();
    }
  });

  it("delivers a terminal exit that happened while disconnected once the session resumes", async () => {
    const { connection, openSession, webSocket } = createConnectionFixture({
      autoReconnect: false,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }
      const exited = {
        type: "terminal.exited" as const,
        terminalId: "term-1",
        exitCode: 0,
        closeReason: "process-exit" as const,
      };

      socket.onclose?.({ code: 1006, reason: "" });
      expect(connection.sendMessage(exited)).toBe(true);
      expect(webSocket.sentMessages(socket)).toEqual([]);

      socket.onopen?.({ type: "open" });
      expect(webSocket.sentMessages(socket)).toEqual([exited]);
      expect(openSession).toHaveBeenCalledTimes(1);
    } finally {
      await connection.shutdown();
    }
  });

  it("delivers messages queued while disconnected before newer ones once the session resumes", async () => {
    const { connection, logger, webSocket } = createConnectionFixture();
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");
      const identity = (label: string) => ({
        type: "connect-tunnel.identity" as const,
        identity: { label, baseDomain: "getbb.app" },
      });

      socket.reconnect();
      connection.sendMessage(identity("queued-while-away"));
      webSocket.setBufferedAmount(socket, 2 * 1024 * 1024);
      await vi.waitFor(() =>
        expect(logger.info).toHaveBeenCalledWith(
          { sessionId: "session-1" },
          "Reconnected; resuming the server session",
        ),
      );
      connection.sendMessage(identity("sent-after-resume"));
      webSocket.setBufferedAmount(socket, 0);

      await vi.waitFor(() =>
        expect(
          webSocket
            .sentMessages(socket)
            .filter((message) =>
              JSON.stringify(message).includes("connect-tunnel.identity"),
            ),
        ).toEqual([
          identity("queued-while-away"),
          identity("sent-after-resume"),
        ]),
      );
    } finally {
      await connection.shutdown();
    }
  });

  it("re-sends the newest recoverable message in the next session when only an older one with its key was acknowledged", async () => {
    const { connection, logger, webSocket } = createConnectionFixture({
      sessionIds: ["first", "second"],
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) throw new Error("Expected test socket");
      const identity = (label: string) => ({
        type: "connect-tunnel.identity" as const,
        identity: { label, baseDomain: "getbb.app" },
      });
      vi.mocked(socket.send).mockImplementation((frame: string) => {
        if (frame.includes('"label":"older"')) {
          webSocket.setBufferedAmount(socket, 2 * 1024 * 1024);
        }
      });

      socket.reconnect();
      connection.sendMessage(identity("older"));
      connection.sendMessage(identity("newer"));
      await vi.waitFor(() =>
        expect(logger.info).toHaveBeenCalledWith(
          { sessionId: "first" },
          "Reconnected; resuming the server session",
        ),
      );
      const olderFrame = parseSentFrames(socket).find((frame) =>
        JSON.stringify(frame).includes('"label":"older"'),
      );
      if (
        typeof olderFrame !== "object" ||
        olderFrame === null ||
        !("seq" in olderFrame) ||
        typeof olderFrame.seq !== "number"
      ) {
        throw new Error("Expected the older identity frame");
      }
      webSocket.deliver(socket, { type: "heartbeat-ack" }, olderFrame.seq);
      vi.mocked(socket.send).mockClear();
      webSocket.setBufferedAmount(socket, 0);

      webSocket.deliver(socket, { type: "session-close", reason: "expired" });
      await vi.waitFor(() => expect(connection.sessionId).toBe("second"));
      await vi.waitFor(() =>
        expect(webSocket.sentMessages(socket)).toContainEqual(
          identity("newer"),
        ),
      );
    } finally {
      await connection.shutdown();
    }
  });

  it("delivers a terminal exit that happened while disconnected in the next session when the server cannot resume", async () => {
    const { connection, webSocket } = createConnectionFixture({
      sessionIds: ["first", "second"],
      rejectResume: true,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }
      const exited = {
        type: "terminal.exited" as const,
        terminalId: "term-1",
        exitCode: 0,
        closeReason: "process-exit" as const,
      };

      socket.reconnect();
      connection.sendMessage(exited);

      await vi.waitFor(() => expect(connection.sessionId).toBe("second"));
      await vi.waitFor(() =>
        expect(webSocket.sentMessages(socket)).toContainEqual(exited),
      );
      expect(
        webSocket
          .sentMessages(socket)
          .filter((message) =>
            JSON.stringify(message).includes("terminal.exited"),
          ),
      ).toHaveLength(1);
    } finally {
      await connection.shutdown();
    }
  });

  it("reconnects and keeps a message for replay when a websocket send throws", async () => {
    const { connection, openSession, webSocket } = createConnectionFixture();
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }
      const output = {
        type: "terminal.output" as const,
        terminalId: "term-1",
        chunk: {
          seq: 0,
          dataBase64: Buffer.from("hello").toString("base64"),
        },
      };
      vi.mocked(socket.send).mockImplementationOnce(() => {
        throw new Error("send failed");
      });

      expect(connection.sendMessage(output)).toBe(true);
      expect(socket.reconnect).toHaveBeenCalledWith(1013, "send-failed");
      await vi.waitFor(() =>
        expect(webSocket.sentMessages(socket)).toEqual([output, output]),
      );
      expect(openSession).toHaveBeenCalledTimes(1);
    } finally {
      await connection.shutdown();
    }
  });

  it("forwards host RPC cancellations to the cancel handler", async () => {
    const onHostRpcCancel = vi.fn();
    const { connection, webSocket } = createConnectionFixture({
      onHostRpcCancel,
    });
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }

      webSocket.deliver(socket, {
        type: "host-rpc.cancel",
        requestId: "rpc-cancelled",
      });

      expect(onHostRpcCancel).toHaveBeenCalledWith({
        type: "host-rpc.cancel",
        requestId: "rpc-cancelled",
      });
    } finally {
      await connection.shutdown();
    }
  });

  it("rejects a malformed host RPC command without disconnecting", async () => {
    const { connection, logger, setSession, webSocket } =
      createConnectionFixture();
    try {
      await connection.start();
      const socket = webSocket.sockets[0];
      if (!socket) {
        throw new Error("Expected test socket");
      }

      webSocket.deliver(socket, {
        type: "host-rpc.request",
        requestId: "invalid-transcription",
        command: {
          type: "thread.stop",
          aimedAt: null,
          intent: "interrupt",
          environmentId: "",
          threadId: "",
        },
      });

      expect(webSocket.sentMessages(socket)).toContainEqual({
        type: "host-rpc.response",
        requestId: "invalid-transcription",
        commandType: "thread.stop",
        ok: false,
        errorCode: "invalid_command",
        errorMessage: "Invalid host RPC command",
      });
      expect(socket.close).not.toHaveBeenCalled();
      expect(setSession).not.toHaveBeenLastCalledWith(null);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          commandType: "thread.stop",
          requestId: "invalid-transcription",
        }),
        "Rejected invalid host RPC command",
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
