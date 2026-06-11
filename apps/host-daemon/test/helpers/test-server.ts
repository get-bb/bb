import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Hono } from "hono";
import {
  HOST_DAEMON_WEBSOCKET_PROTOCOL,
  buildHostDaemonWebSocketAuthorizationHeader,
  hostDaemonEnrollRequestSchema,
  hostDaemonDaemonWsMessageSchema,
  hostDaemonEventBatchRequestSchema,
  hostDaemonInteractiveRequestSchema,
  hostDaemonSessionOpenRequestSchema,
  hostDaemonToolCallRequestSchema,
  hostDaemonWorkflowRunEventBatchRequestSchema,
  hostDaemonWorkflowRunJournalQuerySchema,
  type HostDaemonCommand,
  type HostDaemonDaemonWsMessage,
  type HostDaemonEventEnvelope,
  type HostDaemonInteractiveRequest,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonServerWsMessage,
  type HostDaemonSessionOpenRequest,
  type HostDaemonToolCallRequest,
  type HostDaemonTrackedThreadTarget,
  type HostDaemonWorkflowRunEventEnvelope,
} from "@bb/host-daemon-contract";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function serveHonoRequest(
  app: Hono,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readRequestBody(request);
  const honoRequest = new Request(
    new URL(request.url ?? "/", "http://127.0.0.1"),
    {
      method: request.method,
      headers: request.headers as HeadersInit,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : body.toString("utf8"),
    },
  );
  const honoResponse = await app.fetch(honoRequest);

  response.statusCode = honoResponse.status;
  honoResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });
  response.end(Buffer.from(await honoResponse.arrayBuffer()));
}

function readHeaderValue(
  header: string | string[] | undefined,
): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

export interface CreateTestServerOptions {
  enforceActiveSessions?: boolean;
  eventPostFailures?: number;
  heartbeatIntervalMs?: number;
  interactiveRequestFailures?: number;
  leaseTimeoutMs?: number;
  requireTurnStartedForInteractiveRequests?: boolean;
  requireTurnStartedForToolCalls?: boolean;
  /** When set, `/session/open` responds with this status and an api-error body. */
  sessionOpenErrorStatus?: number;
  trackedThreadTargets?: HostDaemonTrackedThreadTarget[];
}

interface TurnStartedLookup {
  threadId: string;
  turnId: string;
}

export type TestServerRequestLogEntry =
  | {
      kind: "events";
      events: HostDaemonEventEnvelope[];
    }
  | {
      kind: "interactive-request";
      request: HostDaemonInteractiveRequest;
    }
  | {
      kind: "tool-call";
      request: HostDaemonToolCallRequest;
    };

/**
 * A command result as captured from the daemon's host-rpc.response WS message.
 * The `type` field mirrors the command type for convenient assertions.
 */
export interface CommandResult {
  commandId: string;
  attemptId: string;
  type: string;
  ok: boolean;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface TestServer {
  baseUrl: string;
  commandResults: CommandResult[];
  eventBatchRequests: Array<{
    events: HostDaemonEventEnvelope[];
    sessionId: string;
  }>;
  workflowRunEventBatchRequests: Array<{
    events: HostDaemonWorkflowRunEventEnvelope[];
    sessionId: string;
  }>;
  eventPostAttemptCount: number;
  events: HostDaemonEventEnvelope[];
  heartbeats: Array<{
    sessionId: string;
    message: HostDaemonDaemonWsMessage;
  }>;
  interactiveRequests: HostDaemonInteractiveRequest[];
  rejectedSessionRequests: Array<{
    path: string;
    sessionId: string;
  }>;
  registeredInteractiveRequests: HostDaemonInteractiveRequest[];
  requestLog: TestServerRequestLogEntry[];
  sessionOpenCalls: HostDaemonSessionOpenRequest[];
  toolCalls: Array<{ sessionId: string; tool: string }>;
  failNextEventPosts(count: number): void;
  queueCommand(command: HostDaemonCommand): { id: string; attemptId: string };
  sendWebSocketMessage(message: HostDaemonServerWsMessage): void;
  setWebSocketAvailable(available: boolean): void;
  closeWebSockets(): void;
  socketCount(): number;
  close(): Promise<void>;
  readonly enrollKey: string;
  readonly hostKey: string;
}

export async function createTestServer(
  options: CreateTestServerOptions = {},
): Promise<TestServer> {
  const sessionOpenCalls: HostDaemonSessionOpenRequest[] = [];
  const heartbeats: Array<{
    sessionId: string;
    message: HostDaemonDaemonWsMessage;
  }> = [];
  const commandResults: CommandResult[] = [];
  const eventBatchRequests: TestServer["eventBatchRequests"] = [];
  const workflowRunEventBatchRequests: TestServer["workflowRunEventBatchRequests"] =
    [];
  const toolCalls: Array<{ sessionId: string; tool: string }> = [];
  const interactiveRequests: HostDaemonInteractiveRequest[] = [];
  const rejectedSessionRequests: TestServer["rejectedSessionRequests"] = [];
  const registeredInteractiveRequests: HostDaemonInteractiveRequest[] = [];
  const requestLog: TestServerRequestLogEntry[] = [];
  const events: HostDaemonEventEnvelope[] = [];
  const activeSockets = new Set<WebSocket>();
  const activeSocketSessionIds = new Map<WebSocket, string>();
  const activeSessionIds = new Set<string>();
  const pendingCommandRequests: HostDaemonOnlineRpcRequestMessage[] = [];
  const pendingCommandMeta = new Map<
    string,
    { commandType: string; attemptId: string }
  >();
  let eventPostAttemptCount = 0;
  let eventPostFailuresRemaining = options.eventPostFailures ?? 0;
  let interactiveRequestFailuresRemaining =
    options.interactiveRequestFailures ?? 0;
  let nextCursor = 1;
  let nextEventSequence = 1;
  let nextSessionId = 1;
  let webSocketAvailable = true;
  const enrollKey = "enroll-secret";
  const hostKey = "host-secret";

  const app = new Hono();

  function rejectInactiveSession(
    path: string,
    sessionId: string,
  ): Response | null {
    if (!options.enforceActiveSessions || activeSessionIds.has(sessionId)) {
      return null;
    }
    rejectedSessionRequests.push({ path, sessionId });
    return new Response(
      JSON.stringify({
        code: "session_not_found",
        message: "Session not found",
      }),
      {
        status: 404,
        headers: { "content-type": "application/json" },
      },
    );
  }

  function hasPostedTurnStarted(args: TurnStartedLookup): boolean {
    return events.some(
      (e) =>
        e.threadId === args.threadId &&
        e.event.type === "turn/started" &&
        e.event.scope.kind === "turn" &&
        e.event.scope.turnId === args.turnId,
    );
  }

  function flushPendingCommandsToSocket(socket: WebSocket, sessionId: string): void {
    while (pendingCommandRequests.length > 0) {
      const req = pendingCommandRequests.shift();
      if (req) {
        socket.send(JSON.stringify(req));
        activeSocketSessionIds.set(socket, sessionId);
      }
    }
  }

  app.post("/internal/hosts/enroll", async (context) => {
    const authorization = context.req.header("authorization");
    if (authorization !== `Bearer ${enrollKey}`) {
      return new Response(
        JSON.stringify({ code: "unauthorized", message: "Invalid enroll key" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const payload = hostDaemonEnrollRequestSchema.parse(
      await context.req.json(),
    );
    return context.json(
      {
        hostId: payload.hostId,
        hostKey,
      },
      201,
    );
  });
  app.post("/internal/session/open", async (context) => {
    const payload = hostDaemonSessionOpenRequestSchema.parse(
      await context.req.json(),
    );
    sessionOpenCalls.push(payload);
    if (options.sessionOpenErrorStatus !== undefined) {
      return new Response(
        JSON.stringify({
          code: "invalid_request",
          message: "Invalid input: expected current protocol version",
        }),
        {
          status: options.sessionOpenErrorStatus,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return context.json(
      {
        sessionId: `session-${nextSessionId++}`,
        heartbeatIntervalMs: options.heartbeatIntervalMs ?? 25,
        leaseTimeoutMs: options.leaseTimeoutMs ?? 1_000,
        trackedThreadTargets: options.trackedThreadTargets ?? [],
        trackedApplicationDataTargets: [],
        retiredEnvironmentIds: [],
      },
      201,
    );
  });
  app.post("/internal/session/events", async (context) => {
    const payload = hostDaemonEventBatchRequestSchema.parse(
      await context.req.json(),
    );
    eventBatchRequests.push({
      events: payload.events,
      sessionId: payload.sessionId,
    });
    const rejectedResponse = rejectInactiveSession(
      "/session/events",
      payload.sessionId,
    );
    if (rejectedResponse) {
      return rejectedResponse;
    }
    eventPostAttemptCount += 1;
    if (eventPostFailuresRemaining > 0) {
      eventPostFailuresRemaining -= 1;
      return new Response(
        JSON.stringify({
          code: "event_post_unavailable",
          message: "Event post is temporarily unavailable",
          retryable: true,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 503,
        },
      );
    }
    events.push(...payload.events);
    requestLog.push({
      kind: "events",
      events: payload.events,
    });
    const acceptedEvents = payload.events.map((event, index) => ({
      eventIndex: index,
      threadId: event.threadId,
      sequence: nextEventSequence++,
    }));
    return context.json({ acceptedEvents, rejectedEvents: [] });
  });
  app.post("/internal/session/workflow-run-events", async (context) => {
    const payload = hostDaemonWorkflowRunEventBatchRequestSchema.parse(
      await context.req.json(),
    );
    const rejectedResponse = rejectInactiveSession(
      "/session/workflow-run-events",
      payload.sessionId,
    );
    if (rejectedResponse) {
      return rejectedResponse;
    }
    workflowRunEventBatchRequests.push({
      events: payload.events,
      sessionId: payload.sessionId,
    });
    const acceptedEvents = payload.events.map((event) => ({
      producerEventId: event.producerEventId,
      runId: event.runId,
      sequence: nextEventSequence++,
    }));
    return context.json({ acceptedEvents, rejectedEvents: [] });
  });
  app.get("/internal/session/workflow-run-journal", (context) => {
    const query = hostDaemonWorkflowRunJournalQuerySchema.parse(
      context.req.query(),
    );
    const rejectedResponse = rejectInactiveSession(
      "/session/workflow-run-journal",
      query.sessionId,
    );
    if (rejectedResponse) {
      return rejectedResponse;
    }
    return context.json({ entries: [] });
  });
  app.post("/internal/session/tool-call", async (context) => {
    const payload = hostDaemonToolCallRequestSchema.parse(
      await context.req.json(),
    );
    const rejectedResponse = rejectInactiveSession(
      "/session/tool-call",
      payload.sessionId,
    );
    if (rejectedResponse) {
      return rejectedResponse;
    }
    requestLog.push({
      kind: "tool-call",
      request: payload,
    });
    if (
      options.requireTurnStartedForToolCalls === true &&
      !hasPostedTurnStarted({
        threadId: payload.threadId,
        turnId: payload.turnId,
      })
    ) {
      return new Response(
        JSON.stringify({
          code: "turn_start_not_ready",
          message:
            "Turn start has not been stored yet; tool call was forwarded too early",
          retryable: false,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 503,
        },
      );
    }
    toolCalls.push({
      sessionId: payload.sessionId,
      tool: payload.tool,
    });
    return context.json({
      success: true,
      contentItems: [{ type: "inputText", text: "ok" }],
    });
  });
  app.post("/internal/session/interactive-request", async (context) => {
    const payload = hostDaemonInteractiveRequestSchema.parse(
      await context.req.json(),
    );
    const rejectedResponse = rejectInactiveSession(
      "/session/interactive-request",
      payload.sessionId,
    );
    if (rejectedResponse) {
      return rejectedResponse;
    }
    interactiveRequests.push(payload);
    requestLog.push({
      kind: "interactive-request",
      request: payload,
    });
    if (
      options.requireTurnStartedForInteractiveRequests === true &&
      !hasPostedTurnStarted({
        threadId: payload.interaction.threadId,
        turnId: payload.interaction.turnId,
      })
    ) {
      return new Response(
        JSON.stringify({
          code: "turn_start_not_ready",
          message:
            "Turn start has not been stored yet; retry interactive request registration",
          retryable: true,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 503,
        },
      );
    }
    if (interactiveRequestFailuresRemaining > 0) {
      interactiveRequestFailuresRemaining -= 1;
      return new Response(
        JSON.stringify({
          code: "turn_start_not_ready",
          message:
            "Turn start has not been stored yet; retry interactive request registration",
          retryable: true,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 503,
        },
      );
    }
    registeredInteractiveRequests.push(payload);
    return context.json({
      outcome: "created",
      interactionId: `interaction-${registeredInteractiveRequests.length}`,
      status: "pending",
    });
  });
  app.post("/internal/session/interactive-request/interrupt", async (context) => {
    return context.json({ ok: true, interactionIds: [] });
  });

  const server = createServer(async (request, response) => {
    await serveHonoRequest(app, request, response);
  });
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      url.pathname !== "/internal/ws" ||
      !webSocketAvailable ||
      readHeaderValue(request.headers.authorization) !==
        buildHostDaemonWebSocketAuthorizationHeader(hostKey) ||
      readHeaderValue(request.headers["sec-websocket-protocol"]) !==
        HOST_DAEMON_WEBSOCKET_PROTOCOL
    ) {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(
      request,
      socket,
      head,
      (websocket: WebSocket) => {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        activeSockets.add(websocket);
        activeSessionIds.add(sessionId);
        activeSocketSessionIds.set(websocket, sessionId);

        // Deliver any buffered commands to this new connection
        flushPendingCommandsToSocket(websocket, sessionId);

        websocket.on("message", (data: RawData) => {
          const message = hostDaemonDaemonWsMessageSchema.parse(
            JSON.parse(data.toString("utf8")),
          );
          heartbeats.push({
            sessionId,
            message,
          });

          // Capture command results from host-rpc.response messages
          if (message.type === "host-rpc.response") {
            const meta = pendingCommandMeta.get(message.requestId);
            let resultPayload: Record<string, unknown> | undefined;
            let errorCode: string | undefined;
            let errorMessage: string | undefined;
            if (message.ok) {
              // The result field is typed per commandType in the union;
              // store it as a generic record for test assertions.
              resultPayload =
                "result" in message &&
                message.result !== null &&
                typeof message.result === "object"
                  ? (message.result as Record<string, unknown>)
                  : undefined;
            } else {
              errorCode = message.errorCode;
              errorMessage = message.errorMessage;
            }
            const commandResult: CommandResult = {
              commandId: message.requestId,
              attemptId: meta?.attemptId ?? message.requestId,
              type: message.commandType,
              ok: message.ok,
              result: resultPayload,
              errorCode,
              errorMessage,
            };
            commandResults.push(commandResult);
          }
        });
        websocket.on("close", () => {
          activeSockets.delete(websocket);
          activeSocketSessionIds.delete(websocket);
          activeSessionIds.delete(sessionId);
        });
        websocketServer.emit("connection", websocket, request);
      },
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    commandResults,
    eventBatchRequests,
    workflowRunEventBatchRequests,
    get eventPostAttemptCount() {
      return eventPostAttemptCount;
    },
    events,
    heartbeats,
    interactiveRequests,
    rejectedSessionRequests,
    registeredInteractiveRequests,
    requestLog,
    sessionOpenCalls,
    toolCalls,
    failNextEventPosts(count: number): void {
      eventPostFailuresRemaining += count;
    },
    queueCommand(command: HostDaemonCommand): { id: string; attemptId: string } {
      const id = `command-${nextCursor}`;
      const attemptId = `attempt-${nextCursor}`;
      nextCursor += 1;

      const requestMessage: HostDaemonOnlineRpcRequestMessage = {
        type: "host-rpc.request",
        requestId: id,
        command,
      };
      pendingCommandMeta.set(id, { commandType: command.type, attemptId });

      // Send immediately to any open socket, or queue for the next connection
      const [firstSocket] = activeSockets;
      if (firstSocket && firstSocket.readyState === 1 /* WebSocket.OPEN */) {
        firstSocket.send(JSON.stringify(requestMessage));
      } else {
        pendingCommandRequests.push(requestMessage);
      }

      return { id, attemptId };
    },
    sendWebSocketMessage(message: HostDaemonServerWsMessage): void {
      const encoded = JSON.stringify(message);
      for (const socket of activeSockets) {
        socket.send(encoded);
      }
    },
    setWebSocketAvailable(available: boolean): void {
      webSocketAvailable = available;
    },
    closeWebSockets(): void {
      for (const socket of activeSockets) {
        socket.close();
      }
    },
    socketCount(): number {
      return activeSockets.size;
    },
    enrollKey,
    hostKey,
    async close(): Promise<void> {
      for (const socket of activeSockets) {
        socket.close();
      }
      await new Promise<void>((resolve, reject) => {
        websocketServer.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
