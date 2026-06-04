import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  HOST_DAEMON_WEBSOCKET_PROTOCOL,
  hostDaemonCommandResultReportSchema,
  type HostDaemonActiveThread,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "../../src/logger.js";
import { dispatchCommand } from "../../src/command-dispatch.js";
import {
  createServerClient,
  type CommandResultRetryOptions,
} from "../../src/server-client.js";
import { ServerConnection } from "../../src/server-connection.js";
import type { ReconnectingWebSocketLike } from "../../src/server-connection-support.js";
import { createTestServer, type TestServer } from "../helpers/test-server.js";
import { createHarness } from "../command/dispatch-helpers.js";

type ServerConnectionOptions = ConstructorParameters<
  typeof ServerConnection
>[0];

interface CreateConnectionOptions {
  commandResultRetryOptions?: CommandResultRetryOptions;
  connectionOverrides?: Partial<ServerConnectionOptions>;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createLogger(): HostDaemonLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createConnection(
  testServer: TestServer,
  options: CreateConnectionOptions = {},
) {
  const sessionState = { value: "" };
  const logger = createLogger();
  const serverClient = createServerClient({
    serverUrl: testServer.baseUrl,
    hostKey: testServer.hostKey,
    logger,
    getSessionId: () => sessionState.value,
    commandResultRetryOptions: options.commandResultRetryOptions,
  });

  const connection = new ServerConnection({
    serverUrl: testServer.baseUrl,
    hostKey: testServer.hostKey,
    hostId: "host-1",
    hostName: "Host One",
    hostType: "persistent",
    dataDir: "/tmp/daemon-data",
    instanceId: "instance-1",
    logger,
    serverClient,
    setSession: (session) => {
      sessionState.value = session?.sessionId ?? "";
    },
    ...options.connectionOverrides,
  });

  return { connection, logger, serverClient };
}

class FakeReconnectingWebSocket implements ReconnectingWebSocketLike {
  readyState = 0;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  constructor(private readonly urlProvider: () => Promise<string>) {}

  async open(): Promise<void> {
    await this.urlProvider();
    this.readyState = 1;
    this.onopen?.({});
  }

  disconnect(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  close(): void {
    this.disconnect();
  }

  reconnect(): void {
    this.disconnect();
    queueMicrotask(() => {
      void this.open();
    });
  }

  send(_data: string): void {}
}

describe("ServerConnection", () => {
  let testServer: TestServer | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    await testServer?.close();
    testServer = null;
  });

  it("opens a session and returns the server config", async () => {
    testServer = await createTestServer();
    const { connection } = createConnection(testServer);

    const session = await connection.start();

    expect(session.sessionId).toBe("session-1");
    expect(Object.hasOwn(session, "threadHighWaterMarks")).toBe(false);
    expect(testServer.sessionOpenCalls).toHaveLength(1);

    await connection.shutdown();
  });

  it("reports known idle threads as active after dispatching turn.submit", async () => {
    testServer = await createTestServer();
    const harness = createHarness();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.manager.markThreadActive("env-1", "thread-1", "provider-1");
    harness.manager.markThreadInactive("env-1", "thread-1");

    await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId: "creq_23456789ab",
        input: [{ type: "text", text: "resume work" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      harness.dispatchOptions(),
    );

    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        getActiveThreads: () => harness.manager.listActiveThreads(),
      },
    });

    await connection.start();

    expect(testServer.sessionOpenCalls[0]?.activeThreads).toEqual([
      {
        threadId: "thread-1",
      },
    ]);

    await connection.shutdown();
  });

  it("sends heartbeat messages over the websocket", async () => {
    testServer = await createTestServer();
    const { connection } = createConnection(testServer);

    await connection.start();
    await waitFor(() => testServer!.heartbeats.length > 0);

    expect(testServer.heartbeats[0]).toEqual({
      sessionId: "session-1",
      message: {
        type: "heartbeat",
      },
    });

    await connection.shutdown();
  });

  it("triggers the fetch callback when commands become available", async () => {
    testServer = await createTestServer();
    const onCommandsAvailable = vi.fn();
    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        onCommandsAvailable,
      },
    });

    await connection.start();
    testServer.sendWebSocketMessage({ type: "commands-available" });
    await waitFor(() => onCommandsAvailable.mock.calls.length === 1);

    expect(onCommandsAvailable).toHaveBeenCalledTimes(1);
    await connection.shutdown();
  });

  it("logs and closes the connection on malformed websocket messages from the server", async () => {
    testServer = await createTestServer();
    const onCommandsAvailable = vi.fn();
    const onSessionClose = vi.fn();
    const sockets: FakeReconnectingWebSocket[] = [];
    const { connection, logger } = createConnection(testServer, {
      connectionOverrides: {
        onCommandsAvailable,
        onSessionClose,
        createWebSocket: (urlProvider) => {
          const socket = new FakeReconnectingWebSocket(urlProvider);
          sockets.push(socket);
          queueMicrotask(() => {
            void socket.open();
          });
          return socket;
        },
      },
    });

    await connection.start();
    const socket = sockets[0];
    if (!socket) {
      throw new Error("Expected fake websocket instance");
    }

    expect(() => socket.receive("{")).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        payloadLength: 1,
        payloadPreview: "{",
        payloadTruncated: false,
      }),
      "Invalid server websocket message; closing connection",
    );
    await waitFor(() => onSessionClose.mock.calls.length === 1);
    expect(onSessionClose).toHaveBeenCalledWith("daemon-disconnect");
    expect(connection.sessionId).toBeNull();
    expect(socket.readyState).toBe(3);

    socket.receive(JSON.stringify({ type: "commands-available" }));
    expect(onCommandsAvailable).not.toHaveBeenCalled();
  });

  it("closes instead of ignoring unknown server protocol messages", async () => {
    testServer = await createTestServer();
    const onSessionClose = vi.fn();
    const sockets: FakeReconnectingWebSocket[] = [];
    const { connection, logger } = createConnection(testServer, {
      connectionOverrides: {
        onSessionClose,
        createWebSocket: (urlProvider) => {
          const socket = new FakeReconnectingWebSocket(urlProvider);
          sockets.push(socket);
          queueMicrotask(() => {
            void socket.open();
          });
          return socket;
        },
      },
    });

    await connection.start();
    const socket = sockets[0];
    if (!socket) {
      throw new Error("Expected fake websocket instance");
    }

    const payload = JSON.stringify({
      type: "session-close",
      reason: "new-server-reason",
      detail: "x".repeat(600),
    });
    expect(() => socket.receive(payload)).not.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        payloadLength: payload.length,
        payloadPreview: payload.slice(0, 512),
        payloadTruncated: true,
      }),
      "Invalid server websocket message; closing connection",
    );
    await waitFor(() => onSessionClose.mock.calls.length === 1);
    expect(onSessionClose).toHaveBeenCalledWith("daemon-disconnect");

    await connection.shutdown();
  });

  it("triggers the shutdown callback when the server closes the session", async () => {
    testServer = await createTestServer();
    const onSessionClose = vi.fn();
    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        onSessionClose,
      },
    });

    await connection.start();
    testServer.sendWebSocketMessage({
      type: "session-close",
      reason: "replaced",
    });
    await waitFor(() => onSessionClose.mock.calls.length === 1);
    await waitFor(() => testServer!.socketCount() === 0);

    expect(onSessionClose).toHaveBeenCalledWith("replaced");
  });

  it("reconnects when the server expires the current session", async () => {
    testServer = await createTestServer({ heartbeatIntervalMs: 10 });
    const openedSessions: string[] = [];
    const onSessionClose = vi.fn();
    const publishedSessions: Array<string | null> = [];
    const { connection, logger } = createConnection(testServer, {
      connectionOverrides: {
        onSessionClose,
        onSessionOpened: (session) => {
          openedSessions.push(session.sessionId);
        },
        setSession: (session) => {
          publishedSessions.push(session?.sessionId ?? null);
        },
      },
    });

    await connection.start();
    expect(connection.sessionId).toBe("session-1");
    expect(testServer.sessionOpenCalls).toHaveLength(1);
    await waitFor(() =>
      testServer!.heartbeats.some(
        (heartbeat) => heartbeat.sessionId === "session-1",
      ),
    );

    testServer.sendWebSocketMessage({
      type: "session-close",
      reason: "expired",
    });
    testServer.closeWebSockets();

    await waitFor(() => testServer!.sessionOpenCalls.length >= 2);
    await waitFor(() => connection.sessionId === "session-2");
    await waitFor(() => testServer!.socketCount() === 1);
    await waitFor(() =>
      testServer!.heartbeats.some(
        (heartbeat) => heartbeat.sessionId === "session-2",
      ),
    );

    expect(testServer.sessionOpenCalls).toHaveLength(2);
    expect(onSessionClose).not.toHaveBeenCalled();
    expect(openedSessions).toEqual(["session-1", "session-2"]);
    expect(publishedSessions).toEqual(["session-1", null, "session-2"]);
    expect(logger.info).toHaveBeenCalledWith(
      { sessionId: "session-1" },
      "Server expired host daemon session; reconnecting",
    );

    await connection.shutdown();
  });

  it("reconnects after the websocket disconnects", async () => {
    testServer = await createTestServer();
    const publishedSessions: Array<string | null> = [];
    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        minReconnectionDelay: 20,
        maxReconnectionDelay: 20,
        pollAfterDisconnectMs: 40,
        pollIntervalMs: 40,
        setSession: (session) => {
          publishedSessions.push(session?.sessionId ?? null);
        },
      },
    });

    await connection.start();
    expect(testServer.sessionOpenCalls).toHaveLength(1);
    expect(publishedSessions).toEqual(["session-1"]);

    testServer.closeWebSockets();

    await waitFor(() => testServer!.sessionOpenCalls.length >= 2);
    expect(testServer.sessionOpenCalls).toHaveLength(2);
    await waitFor(() => publishedSessions.includes("session-2"));
    expect(publishedSessions).toEqual(["session-1", null, "session-2"]);

    await connection.shutdown();
  });

  it("retries command result delivery until the server accepts it", async () => {
    testServer = await createTestServer({ commandResultFailures: 1 });
    const { connection, serverClient } = createConnection(testServer);

    await connection.start();
    const result = await serverClient.reportCommandResult({
      attemptId: "attempt-cmd-1",
      commandId: "cmd-1",
      completedAt: 1,
      type: "turn.submit",
      ok: true,
      result: { appliedAs: "new-turn" },
    });

    expect(testServer.commandResultAttemptCount).toBe(2);
    expect(result).toEqual({ ok: true });
    expect(testServer.commandResultReports).toEqual([
      hostDaemonCommandResultReportSchema.parse({
        sessionId: "session-1",
        attemptId: "attempt-cmd-1",
        commandId: "cmd-1",
        completedAt: 1,
        type: "turn.submit",
        ok: true,
        result: { appliedAs: "new-turn" },
      }),
      hostDaemonCommandResultReportSchema.parse({
        sessionId: "session-1",
        attemptId: "attempt-cmd-1",
        commandId: "cmd-1",
        completedAt: 1,
        type: "turn.submit",
        ok: true,
        result: { appliedAs: "new-turn" },
      }),
    ]);

    await connection.shutdown();
  });

  it("stops retrying command results after the retry budget is exhausted", async () => {
    testServer = await createTestServer({
      commandResultFailures: 10,
      commandResultFailureStatus: 500,
    });
    const { connection, logger, serverClient } = createConnection(testServer, {
      commandResultRetryOptions: {
        maxTimeoutMs: 1,
        minTimeoutMs: 1,
        randomize: false,
        retries: 5,
      },
    });

    await connection.start();

    await expect(
      serverClient.reportCommandResult({
        attemptId: "attempt-cmd-1",
        commandId: "cmd-1",
        completedAt: 1,
        type: "turn.submit",
        ok: true,
        result: { appliedAs: "new-turn" },
      }),
    ).rejects.toThrow(/Failed to report command result/u);

    expect(testServer.commandResultAttemptCount).toBe(6);
    expect(logger.warn).toHaveBeenCalledTimes(6);
    await connection.shutdown();
  });

  it("does not retry command results after a 4xx response", async () => {
    testServer = await createTestServer({
      commandResultFailures: 1,
      commandResultFailureStatus: 400,
    });
    const { connection, logger, serverClient } = createConnection(testServer);

    await connection.start();

    await expect(
      serverClient.reportCommandResult({
        attemptId: "attempt-cmd-1",
        commandId: "cmd-1",
        completedAt: 1,
        type: "turn.submit",
        ok: true,
        result: { appliedAs: "new-turn" },
      }),
    ).rejects.toThrow(/Failed to report command result/u);

    expect(testServer.commandResultAttemptCount).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
    await connection.shutdown();
  });

  it("posts tool calls through the session API", async () => {
    testServer = await createTestServer();
    const { connection, serverClient } = createConnection(testServer);

    await connection.start();
    const response = await serverClient.callTool({
      requestId: 1,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "message_user",
      arguments: { foo: "bar" },
    });

    expect(response).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "ok" }],
    });
    expect(testServer.toolCalls).toEqual([
      {
        sessionId: "session-1",
        tool: "message_user",
      },
    ]);

    await connection.shutdown();
  });

  it("sends environment change hints over the daemon websocket", async () => {
    testServer = await createTestServer();
    const server = testServer;
    const { connection } = createConnection(server);

    await connection.start();
    expect(
      connection.sendMessage({
        type: "environment-change",
        environmentId: "env-1",
        change: "work-status-changed",
      }),
    ).toBe(true);

    await waitFor(() =>
      server.heartbeats.some(
        (entry) => entry.message.type === "environment-change",
      ),
    );
    expect(server.heartbeats).toContainEqual({
      sessionId: "session-1",
      message: {
        type: "environment-change",
        environmentId: "env-1",
        change: "work-status-changed",
      },
    });

    await connection.shutdown();
  });

  it("sends application storage change hints over the daemon websocket", async () => {
    testServer = await createTestServer();
    const server = testServer;
    const { connection } = createConnection(server);

    await connection.start();
    expect(
      connection.sendMessage({
        type: "application-storage-changed",
      }),
    ).toBe(true);

    await waitFor(() =>
      server.heartbeats.some(
        (entry) => entry.message.type === "application-storage-changed",
      ),
    );
    expect(server.heartbeats).toContainEqual({
      sessionId: "session-1",
      message: {
        type: "application-storage-changed",
      },
    });

    await connection.shutdown();
  });

  it("buffers deduplicated environment change hints while disconnected and flushes after reconnect", async () => {
    testServer = await createTestServer();
    const server = testServer;
    const { connection } = createConnection(server);

    expect(
      connection.sendMessage({
        type: "environment-change",
        environmentId: "env-1",
        change: "work-status-changed",
      }),
    ).toBe(false);
    expect(
      connection.sendMessage({
        type: "environment-change",
        environmentId: "env-1",
        change: "work-status-changed",
      }),
    ).toBe(false);
    expect(
      connection.sendMessage({
        type: "environment-change",
        environmentId: "env-1",
        change: "thread-storage-changed",
      }),
    ).toBe(false);
    expect(server.heartbeats).toEqual([]);

    await connection.start();
    await waitFor(
      () =>
        server.heartbeats.filter(
          (entry) => entry.message.type === "environment-change",
        ).length === 2,
    );
    expect(
      server.heartbeats.filter(
        (entry) => entry.message.type === "environment-change",
      ),
    ).toEqual([
      {
        sessionId: "session-1",
        message: {
          type: "environment-change",
          environmentId: "env-1",
          change: "work-status-changed",
        },
      },
      {
        sessionId: "session-1",
        message: {
          type: "environment-change",
          environmentId: "env-1",
          change: "thread-storage-changed",
        },
      },
    ]);

    await connection.shutdown();
  });

  it("buffers one application storage change hint while disconnected and flushes after reconnect", async () => {
    testServer = await createTestServer();
    const server = testServer;
    const { connection } = createConnection(server);

    expect(
      connection.sendMessage({
        type: "application-storage-changed",
      }),
    ).toBe(false);
    expect(
      connection.sendMessage({
        type: "application-storage-changed",
      }),
    ).toBe(false);
    expect(server.heartbeats).toEqual([]);

    await connection.start();
    await waitFor(
      () =>
        server.heartbeats.filter(
          (entry) => entry.message.type === "application-storage-changed",
        ).length === 1,
    );
    expect(
      server.heartbeats.filter(
        (entry) => entry.message.type === "application-storage-changed",
      ),
    ).toEqual([
      {
        sessionId: "session-1",
        message: {
          type: "application-storage-changed",
        },
      },
    ]);

    await connection.shutdown();
  });

  it("sends application content change hints over the daemon websocket", async () => {
    testServer = await createTestServer();
    const server = testServer;
    const { connection } = createConnection(server);

    await connection.start();
    expect(
      connection.sendMessage({
        type: "application-content-changed",
        applicationId: "status",
      }),
    ).toBe(true);

    await waitFor(() =>
      server.heartbeats.some(
        (entry) => entry.message.type === "application-content-changed",
      ),
    );
    expect(server.heartbeats).toContainEqual({
      sessionId: "session-1",
      message: {
        type: "application-content-changed",
        applicationId: "status",
      },
    });

    await connection.shutdown();
  });

  it("buffers application content change hints per app while disconnected and flushes after reconnect", async () => {
    testServer = await createTestServer();
    const server = testServer;
    const { connection } = createConnection(server);

    expect(
      connection.sendMessage({
        type: "application-content-changed",
        applicationId: "status",
      }),
    ).toBe(false);
    expect(
      connection.sendMessage({
        type: "application-content-changed",
        applicationId: "status",
      }),
    ).toBe(false);
    expect(
      connection.sendMessage({
        type: "application-content-changed",
        applicationId: "tasks",
      }),
    ).toBe(false);
    expect(server.heartbeats).toEqual([]);

    await connection.start();
    await waitFor(
      () =>
        server.heartbeats.filter(
          (entry) => entry.message.type === "application-content-changed",
        ).length === 2,
    );
    expect(
      server.heartbeats.filter(
        (entry) => entry.message.type === "application-content-changed",
      ),
    ).toEqual([
      {
        sessionId: "session-1",
        message: {
          type: "application-content-changed",
          applicationId: "status",
        },
      },
      {
        sessionId: "session-1",
        message: {
          type: "application-content-changed",
          applicationId: "tasks",
        },
      },
    ]);

    await connection.shutdown();
  });

  it("buffers mixed recoverable hint kinds without collisions and flushes them in arrival order", async () => {
    testServer = await createTestServer();
    const server = testServer;
    const { connection } = createConnection(server);

    expect(
      connection.sendMessage({
        type: "application-content-changed",
        applicationId: "status",
      }),
    ).toBe(false);
    expect(
      connection.sendMessage({
        type: "application-storage-changed",
      }),
    ).toBe(false);
    expect(
      connection.sendMessage({
        type: "environment-change",
        environmentId: "env-1",
        change: "work-status-changed",
      }),
    ).toBe(false);
    expect(server.heartbeats).toEqual([]);

    await connection.start();
    await waitFor(
      () =>
        server.heartbeats.filter(
          (entry) => entry.message.type !== "heartbeat",
        ).length === 3,
    );
    expect(
      server.heartbeats.filter((entry) => entry.message.type !== "heartbeat"),
    ).toEqual([
      {
        sessionId: "session-1",
        message: {
          type: "application-content-changed",
          applicationId: "status",
        },
      },
      {
        sessionId: "session-1",
        message: {
          type: "application-storage-changed",
        },
      },
      {
        sessionId: "session-1",
        message: {
          type: "environment-change",
          environmentId: "env-1",
          change: "work-status-changed",
        },
      },
    ]);

    await connection.shutdown();
  });

  it("includes active threads when opening the session", async () => {
    testServer = await createTestServer();
    const activeThreads: HostDaemonActiveThread[] = [
      {
        threadId: "thread-1",
      },
    ];
    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        getActiveThreads: () => activeThreads,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      },
    });

    await connection.start();

    expect(testServer.sessionOpenCalls[0]?.activeThreads).toEqual(
      activeThreads,
    );

    await connection.shutdown();
  });

  it("authenticates websocket upgrades with a bearer header", async () => {
    testServer = await createTestServer();
    let capturedAuthorization: string | undefined;
    let capturedProtocols: string[] | undefined;
    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        createWebSocket: (urlProvider, options) => {
          capturedAuthorization = options.headers?.authorization;
          capturedProtocols = options.protocols;
          const socket = new FakeReconnectingWebSocket(urlProvider);
          queueMicrotask(() => {
            void socket.open();
          });
          return socket;
        },
      },
    });

    await connection.start();

    expect(capturedAuthorization).toBe(`Bearer ${testServer.hostKey}`);
    expect(capturedProtocols).toEqual([HOST_DAEMON_WEBSOCKET_PROTOCOL]);

    await connection.shutdown();
  });

  it("rejects start() when the startup timeout expires before connecting", async () => {
    vi.useFakeTimers();
    testServer = await createTestServer();
    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        startupTimeoutMs: 5_000,
        createWebSocket: (urlProvider) => {
          const socket = new FakeReconnectingWebSocket(urlProvider);
          // Never open — simulate a server that never accepts the connection.
          return socket;
        },
      },
    });

    const startPromise = connection.start().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(5_000);

    const error = await startPromise;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/timed out/u);
  });

  it("fails start() fast with an actionable error on a non-retryable session-open rejection", async () => {
    testServer = await createTestServer({ sessionOpenErrorStatus: 400 });
    const { connection, logger } = createConnection(testServer, {
      connectionOverrides: {
        startupTimeoutMs: 60_000,
        createWebSocket: (urlProvider) => {
          const socket = new FakeReconnectingWebSocket(urlProvider);
          queueMicrotask(() => {
            void socket.open().catch(() => socket.onerror?.({}));
          });
          return socket;
        },
      },
    });

    const error = await connection.start().catch((err: Error) => err);

    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 400, code: "invalid_request" }),
      expect.stringContaining("incompatible protocol version"),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Waiting for server...",
    );
  });

  it("logs and retries when the websocket closes before opening", async () => {
    testServer = await createTestServer();
    let attempt = 0;
    const { connection, logger } = createConnection(testServer, {
      connectionOverrides: {
        createWebSocket: (urlProvider) => {
          const socket = new FakeReconnectingWebSocket(urlProvider);
          queueMicrotask(() => {
            attempt += 1;
            if (attempt === 1) {
              // First attempt: close before open.
              socket.disconnect();
              // Simulate partysocket reconnecting on the same instance.
              queueMicrotask(() => {
                void socket.open();
              });
            } else {
              void socket.open();
            }
          });
          return socket;
        },
      },
    });

    const session = await connection.start();
    expect(session.sessionId).toBe("session-1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({}),
      "Waiting for server connection...",
    );

    await connection.shutdown();
  });

  it("does not poll for commands while the websocket session is disconnected", async () => {
    vi.useFakeTimers();
    testServer = await createTestServer();
    const onCommandsAvailable = vi.fn();
    const sockets: FakeReconnectingWebSocket[] = [];
    const { connection } = createConnection(testServer, {
      connectionOverrides: {
        onCommandsAvailable,
        pollAfterDisconnectMs: 5_000,
        pollIntervalMs: 10_000,
        createWebSocket: (urlProvider) => {
          const socket = new FakeReconnectingWebSocket(urlProvider);
          sockets.push(socket);
          queueMicrotask(() => {
            void socket.open();
          });
          return socket;
        },
      },
    });

    await connection.start();
    const socket = sockets[0];
    if (!socket) {
      throw new Error("Expected fake websocket instance");
    }

    socket.disconnect();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(onCommandsAvailable).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onCommandsAvailable).not.toHaveBeenCalled();

    await socket.open();
    expect(testServer.sessionOpenCalls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(onCommandsAvailable).not.toHaveBeenCalled();

    await connection.shutdown();
  });
});
