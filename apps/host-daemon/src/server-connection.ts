import { Buffer } from "node:buffer";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  HOST_DAEMON_WS_RESUME_FROM_QUERY_PARAM,
  HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE,
  HOST_DAEMON_WS_SHUTDOWN_CLOSE_REASON,
  HostDaemonWsSequencer,
  buildHostDaemonWebSocketAuthorizationHeader,
  buildHostDaemonWebSocketProtocols,
  hostDaemonDaemonWsMessageSchema,
  hostDaemonRpcCommandTypeSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonSessionCloseReason,
  type HostDaemonSessionOpenResponse,
  type HostDaemonDaemonWsMessage,
} from "@bb/host-daemon-contract";
import { z } from "zod";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_RECONNECTION_DELAY,
  DEFAULT_MIN_RECONNECTION_DELAY,
  DEFAULT_RECONNECTION_DELAY_GROW_FACTOR,
  DEFAULT_STARTUP_TIMEOUT_MS,
  OPEN_READY_STATE,
  createDefaultReconnectingWebSocket,
  decodeWebSocketMessageData,
  type CreateReconnectingWebSocket,
  type ReconnectingWebSocketLike,
  type ServerConnectionOptions,
} from "./server-connection-support.js";
import { isLikelySystemSuspensionDelay } from "@bb/process-utils";
import { sliceUtf16Head } from "@bb/text-utils";
import { normalizeCaughtError, runtimeErrorLogFields } from "./error-utils.js";
import { ServerResponseError } from "./server-client.js";

export type { CreateReconnectingWebSocket } from "./server-connection-support.js";

interface InvalidServerMessageArgs {
  data: unknown;
  error: Error;
}

const invalidHostRpcRequestEnvelopeSchema = z
  .object({
    type: z.literal("host-rpc.request"),
    requestId: z.string().min(1),
    command: z.object({ type: hostDaemonRpcCommandTypeSchema }).passthrough(),
  })
  .passthrough();

interface ServerMessagePayloadSummary {
  payloadLength: number;
  payloadPreview: string;
  payloadTruncated: boolean;
}

export type ServerSessionInvalidationSource =
  | "callTool"
  | "fetchProjectAttachment"
  | "fetchSkillTree"
  | "fetchPluginHostArtifact"
  | "interruptInteractiveRequests"
  | "postEvents"
  | "registerInteractiveRequest";

export interface HandleServerSessionInvalidatedArgs {
  code: "inactive_session";
  observedSessionId: string;
  source: ServerSessionInvalidationSource;
}

type SessionCloseHandler = (
  reason: HostDaemonSessionCloseReason,
) => void | Promise<void>;

const SERVER_MESSAGE_PAYLOAD_PREVIEW_CHARS = 512;
const TERMINAL_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
const TERMINAL_SOCKET_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
const TERMINAL_SOCKET_DRAIN_POLL_MS = 10;

interface RecoverableMessage {
  key: string;
  message: HostDaemonDaemonWsMessage;
}

interface PendingSocketPayload {
  bytes: number;
  payload: string;
  recoverable: RecoverableMessage | null;
}

interface SentRecoverableMessage {
  message: HostDaemonDaemonWsMessage;
  seq: number;
}

function recoverableMessageKey(
  message: HostDaemonDaemonWsMessage,
): string | null {
  switch (message.type) {
    case "connect-tunnel.identity":
      return "connect-tunnel.identity";
    case "connect-next.status":
      return "connect-next.status";
    case "environment-change":
      return `environment-change\u0000${message.environmentId}\u0000${message.change}`;
    case "environment-metadata-change":
      return `environment-metadata-change\u0000${message.environmentId}`;
    case "terminal.exited":
      return `terminal.exited\u0000${message.terminalId}`;
    default:
      return null;
  }
}

function isTerminalDaemonOutputMessage(
  message: HostDaemonDaemonWsMessage,
): boolean {
  return message.type === "terminal.output";
}

function isTerminalDaemonLifecycleMessage(
  message: HostDaemonDaemonWsMessage,
): boolean {
  switch (message.type) {
    case "terminal.error":
    case "terminal.exited":
    case "terminal.opened":
    case "terminal.replay":
      return true;
    default:
      return false;
  }
}

function summarizeServerMessagePayload(
  data: unknown,
): ServerMessagePayloadSummary {
  const text = decodeWebSocketMessageData(data);
  return {
    payloadLength: text.length,
    payloadPreview: sliceUtf16Head(text, SERVER_MESSAGE_PAYLOAD_PREVIEW_CHARS),
    payloadTruncated: text.length > SERVER_MESSAGE_PAYLOAD_PREVIEW_CHARS,
  };
}

export class ServerConnection {
  private readonly createWebSocket: CreateReconnectingWebSocket;
  private readonly startupTimeoutMs: number;

  private session: HostDaemonSessionOpenResponse | null = null;
  private sequencer: HostDaemonWsSequencer | null = null;
  private sessionSocketOpened = false;
  private socketReady = false;
  private dialingResume = false;
  private resumeDeadline: ReturnType<typeof setTimeout> | null = null;
  private machineEnvironmentRevision = -1;
  private websocket: ReconnectingWebSocketLike | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAcknowledgedAt: number | null = null;
  private lastHeartbeatTickAt: number | null = null;
  private stopped = false;
  private sessionCloseHandler: SessionCloseHandler | undefined;
  private fatalConnectError: ServerResponseError | null = null;
  private protocolMismatchObserved = false;
  private sessionInvalidationInProgress = false;
  private pendingSocketBytes = 0;
  private readonly pendingSocketPayloads: PendingSocketPayload[] = [];
  private socketDrainTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingRecoverableMessages = new Map<
    string,
    HostDaemonDaemonWsMessage
  >();
  private readonly sentRecoverableMessages = new Map<
    string,
    SentRecoverableMessage
  >();

  constructor(private readonly options: ServerConnectionOptions) {
    this.createWebSocket =
      options.createWebSocket ?? createDefaultReconnectingWebSocket;
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  }

  get sessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  async start(): Promise<HostDaemonSessionOpenResponse> {
    this.stopped = false;
    return this.connectWebSocket();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.pendingRecoverableMessages.clear();
    this.sessionInvalidationInProgress = false;
    this.clearHeartbeat();
    this.abandonSession();

    if (this.websocket) {
      const websocket = this.websocket;
      this.websocket = null;
      websocket.onmessage = null;
      websocket.onclose = null;
      websocket.close(1000, HOST_DAEMON_WS_SHUTDOWN_CLOSE_REASON);
    }
  }

  sendMessage(message: HostDaemonDaemonWsMessage): boolean {
    const parsed = hostDaemonDaemonWsMessageSchema.parse(message);
    const recoverableKey = recoverableMessageKey(parsed);
    const recoverable =
      recoverableKey === null ? null : { key: recoverableKey, message: parsed };
    if (recoverable !== null) {
      this.pendingRecoverableMessages.set(recoverable.key, parsed);
    }
    if (this.sequencer === null) {
      return false;
    }

    const payload = JSON.stringify(parsed);
    const websocket = this.connectedWebSocket();
    if (
      websocket === null ||
      (isTerminalDaemonOutputMessage(parsed) &&
        (this.pendingSocketPayloads.length > 0 ||
          (websocket.bufferedAmount ?? 0) > TERMINAL_SOCKET_HIGH_WATER_BYTES))
    ) {
      return this.enqueueSocketPayload(payload, recoverable);
    }
    if (
      isTerminalDaemonLifecycleMessage(parsed) &&
      this.pendingSocketPayloads.length > 0
    ) {
      const queued = this.enqueueSocketPayload(payload, recoverable);
      this.flushSocketPayloads(true);
      return queued;
    }
    return this.writeSocketPayload(websocket, payload, recoverable);
  }

  private connectedWebSocket(): ReconnectingWebSocketLike | null {
    const websocket = this.websocket;
    if (
      !this.socketReady ||
      !websocket ||
      websocket.readyState !== OPEN_READY_STATE
    ) {
      return null;
    }
    return websocket;
  }

  private writeSocketPayload(
    websocket: ReconnectingWebSocketLike,
    payload: string,
    recoverable: RecoverableMessage | null,
  ): boolean {
    const sequencer = this.sequencer;
    if (sequencer === null) {
      return false;
    }
    const frame = sequencer.encode(payload);
    if (recoverable !== null) {
      this.sentRecoverableMessages.set(recoverable.key, {
        message: recoverable.message,
        seq: sequencer.sentSeq,
      });
    }
    this.sendFrame(websocket, frame);
    return true;
  }

  private sendFrame(
    websocket: ReconnectingWebSocketLike,
    frame: string,
  ): boolean {
    try {
      websocket.send(frame);
      return true;
    } catch (error) {
      this.options.logger.warn(
        { ...runtimeErrorLogFields(error) },
        "Failed to send websocket message",
      );
      this.socketReady = false;
      websocket.reconnect(1013, "send-failed");
      return false;
    }
  }

  private enqueueSocketPayload(
    payload: string,
    recoverable: RecoverableMessage | null,
  ): boolean {
    const bytes = Buffer.byteLength(payload, "utf8");
    if (this.pendingSocketBytes + bytes > TERMINAL_SOCKET_MAX_QUEUE_BYTES) {
      this.options.logger.warn(
        {
          maxQueueBytes: TERMINAL_SOCKET_MAX_QUEUE_BYTES,
          pendingBytes: this.pendingSocketBytes,
        },
        "Terminal websocket output queue exceeded its limit",
      );
      this.abandonSession();
      this.websocket?.reconnect(1013, "terminal-backpressure");
      return false;
    }
    this.pendingSocketPayloads.push({ bytes, payload, recoverable });
    this.pendingSocketBytes += bytes;
    if (this.connectedWebSocket() !== null) {
      this.scheduleSocketDrain();
    }
    return true;
  }

  private scheduleSocketDrain(): void {
    if (this.socketDrainTimeout !== null) {
      return;
    }
    this.socketDrainTimeout = setTimeout(() => {
      this.socketDrainTimeout = null;
      this.flushSocketPayloads(false);
    }, TERMINAL_SOCKET_DRAIN_POLL_MS);
  }

  private flushSocketPayloads(ignoreHighWater: boolean): void {
    let websocket = this.connectedWebSocket();
    while (
      websocket !== null &&
      this.pendingSocketPayloads.length > 0 &&
      (ignoreHighWater ||
        (websocket.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES)
    ) {
      const pending = this.pendingSocketPayloads.shift();
      if (!pending) {
        break;
      }
      this.pendingSocketBytes -= pending.bytes;
      this.writeSocketPayload(websocket, pending.payload, pending.recoverable);
      websocket = this.connectedWebSocket();
    }
    if (websocket !== null && this.pendingSocketPayloads.length > 0) {
      this.scheduleSocketDrain();
    }
  }

  private clearSocketPayloads(): void {
    if (this.socketDrainTimeout !== null) {
      clearTimeout(this.socketDrainTimeout);
      this.socketDrainTimeout = null;
    }
    this.pendingSocketPayloads.length = 0;
    this.pendingSocketBytes = 0;
  }

  setSessionCloseHandler(handler: SessionCloseHandler | undefined): void {
    this.sessionCloseHandler = handler;
  }

  handleSessionInvalidated(args: HandleServerSessionInvalidatedArgs): void {
    if (this.stopped || this.sessionInvalidationInProgress) {
      return;
    }
    const session = this.session;
    if (!session || session.sessionId !== args.observedSessionId) {
      return;
    }

    this.sessionInvalidationInProgress = true;
    this.options.logger.info(
      {
        code: args.code,
        sessionId: args.observedSessionId,
        source: args.source,
      },
      "Server reported inactive daemon session; reconnecting",
    );
    this.clearHeartbeat();
    this.abandonSession();
    this.websocket?.reconnect(1000, "inactive-session");
  }

  private async openSession(): Promise<HostDaemonSessionOpenResponse> {
    this.fatalConnectError = null;
    try {
      const session = await this.options.serverClient.openSession({
        hostId: this.options.hostId,
        instanceId: this.options.instanceId,
        hostName: this.options.hostName,
        dataDir: this.options.dataDir,
        localApiPort: this.options.localApiPort,
        turnCommandThreadIds: this.options.getTurnCommandThreadIds?.() ?? [],
        activeThreads: this.options.getActiveThreads?.() ?? [],
        openThreadWork: this.options.getOpenThreadWork?.() ?? [],
        undeliveredEventThreadIds:
          this.options.getUndeliveredEventThreadIds?.() ?? [],
        loadedEnvironments: this.options.getLoadedEnvironments?.() ?? [],
      });
      this.session = session;
      this.sequencer = new HostDaemonWsSequencer();
      this.sessionSocketOpened = false;
      this.machineEnvironmentRevision = session.machineEnvironment.revision;
      this.options.onMachineEnvironment?.(session.machineEnvironment);
      this.options.onIdleProviderSessionTimeout?.(
        session.idleProviderSessionTimeoutMinutes,
      );
      this.options.onAgentCpuPriority?.(session.agentCpuPriority);
      return session;
    } catch (error) {
      if (
        error instanceof ServerResponseError &&
        error.serverMoved !== null &&
        this.options.onServerMoved !== undefined
      ) {
        const moved = error.serverMoved;
        this.options.logger.info(
          { serverUrl: moved.serverUrl, toHostName: moved.toHostName },
          "The bb server moved; switching this daemon to the new address",
        );
        const switched = await this.options
          .onServerMoved({
            source: "session-open",
            serverUrl: moved.serverUrl,
            headers: moved.headers ?? null,
            toHostName: moved.toHostName,
            movedAt: moved.movedAt,
          })
          .then(
            () => true,
            (handlerError: unknown) => {
              this.options.logger.error(
                { ...runtimeErrorLogFields(handlerError) },
                "Failed to switch this daemon to the moved bb server",
              );
              return false;
            },
          );
        if (switched) {
          throw error;
        }
      }
      if (
        error instanceof ServerResponseError &&
        error.code === "protocol_version_mismatch"
      ) {
        this.protocolMismatchObserved = true;
        const result =
          await this.options.protocolSelfUpdater?.handleProtocolMismatch({
            force: error.protocolUpdateRetryRequested,
          });
        if (result === "updated") {
          await this.options.onSelfUpdateInstalled?.();
        }
      }
      if (
        error instanceof ServerResponseError &&
        !error.retryable &&
        error.code !== "protocol_version_mismatch"
      ) {
        this.fatalConnectError = error;
        this.logFatalConnectError(error);
      }
      throw error;
    }
  }

  private logFatalConnectError(error: ServerResponseError): void {
    const base = {
      hostId: this.options.hostId,
      serverUrl: this.options.serverUrl,
      status: error.status,
      code: error.code,
      detail: error.bodyMessage,
    };
    if (error.status === 401 || error.status === 403) {
      this.options.logger.error(
        base,
        "Server rejected host credentials — this host is not registered with the server.",
      );
      return;
    }
    this.options.logger.error(
      { ...base, daemonProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION },
      "Server rejected the daemon session. This usually means the server is running an incompatible protocol version — restart it (e.g. `pnpm dev:restart`).",
    );
  }

  private async connectWebSocket(): Promise<HostDaemonSessionOpenResponse> {
    const websocket = this.createWebSocket(
      async () => {
        const resumable = this.resumableSession();
        if (resumable !== null) {
          this.dialingResume = true;
          return this.buildWebSocketUrl(
            resumable.session.sessionId,
            resumable.sequencer.receivedSeq,
          );
        }
        this.dialingResume = false;
        this.abandonSession();
        const session = await this.openSession();
        return this.buildWebSocketUrl(session.sessionId, null);
      },
      {
        minReconnectionDelay: DEFAULT_MIN_RECONNECTION_DELAY,
        maxReconnectionDelay: DEFAULT_MAX_RECONNECTION_DELAY,
        reconnectionDelayGrowFactor: DEFAULT_RECONNECTION_DELAY_GROW_FACTOR,
        connectionTimeout: DEFAULT_CONNECTION_TIMEOUT_MS,
        headers: {
          authorization: buildHostDaemonWebSocketAuthorizationHeader(
            this.options.hostKey,
          ),
          ...this.options.serverHeaders,
        },
        maxRetries: Number.POSITIVE_INFINITY,
        protocols: buildHostDaemonWebSocketProtocols(),
      },
    );
    this.websocket = websocket;

    return new Promise<HostDaemonSessionOpenResponse>((resolve, reject) => {
      let settled = false;
      let hasOpened = false;

      const startupTimer = setTimeout(() => {
        if (this.protocolMismatchObserved) {
          return;
        }
        fail(
          new Error(
            `Server connection timed out after ${this.startupTimeoutMs}ms`,
          ),
        );
      }, this.startupTimeoutMs);

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(startupTimer);
        void this.shutdown();
        reject(normalizeCaughtError(error));
      };

      websocket.onopen = () => {
        this.protocolMismatchObserved = false;
        const session = this.session;
        const sequencer = this.sequencer;
        if (this.dialingResume) {
          if (!session || !sequencer) {
            websocket.reconnect(1000, "session-abandoned");
            return;
          }
          this.resumeSession(websocket, session, sequencer);
          return;
        }
        if (!session) {
          fail(new Error("WebSocket opened before session was available"));
          return;
        }

        const handleOpen = async () => {
          hasOpened = true;
          this.sessionSocketOpened = true;
          this.socketReady = true;
          this.sessionInvalidationInProgress = false;
          clearTimeout(startupTimer);
          this.resetHeartbeat();
          this.options.setSession?.(session);
          this.options.logger.info(
            { sessionId: session.sessionId },
            "Connected to server",
          );
          this.flushSocketPayloads(true);
          await this.options.onSessionOpened?.(session);
          this.flushPendingRecoverableMessages();
          if (!settled) {
            settled = true;
            resolve(session);
          }
        };

        void handleOpen().catch((error) => {
          if (!settled) {
            fail(error);
            return;
          }
          this.options.logger.error(
            { err: error, sessionId: session.sessionId },
            "Failed to finish websocket open handling",
          );
        });
      };

      websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      websocket.onclose = (event) => {
        this.clearHeartbeat();
        this.socketReady = false;
        if (!hasOpened) {
          this.abandonSession();
          this.options.logger.warn(
            { code: event.code, reason: event.reason },
            "Waiting for server connection...",
          );
          return;
        }
        if (event.code === HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE) {
          this.options.logger.info(
            { code: event.code, reason: event.reason },
            "Server could not resume the daemon session; opening a new one",
          );
          this.abandonSession();
          return;
        }
        if (this.stopped) {
          return;
        }
        const resumable = this.resumableSession();
        if (resumable === null) {
          this.abandonSession();
          this.options.logger.info(
            { code: event.code, reason: event.reason },
            "Disconnected from server",
          );
          return;
        }
        if (this.resumeDeadline !== null) {
          return;
        }
        this.options.logger.info(
          {
            code: event.code,
            reason: event.reason,
            reconnectGraceMs: resumable.session.reconnectGraceMs,
            sessionId: resumable.session.sessionId,
          },
          "Disconnected from server; resuming the session",
        );
        this.startResumeDeadline(resumable.session);
      };

      websocket.onerror = (error) => {
        if (hasOpened) {
          this.options.logger.warn({ err: error }, "WebSocket error");
          return;
        }
        if (this.fatalConnectError) {
          fail(this.fatalConnectError);
          return;
        }
        this.options.logger.info(
          { serverUrl: this.options.serverUrl },
          "Waiting for server...",
        );
      };
    });
  }

  private resumableSession(): {
    sequencer: HostDaemonWsSequencer;
    session: HostDaemonSessionOpenResponse;
  } | null {
    const session = this.session;
    const sequencer = this.sequencer;
    if (
      session === null ||
      sequencer === null ||
      session.reconnectGraceMs === 0 ||
      !this.sessionSocketOpened ||
      !sequencer.replayable
    ) {
      return null;
    }
    return { sequencer, session };
  }

  private resumeSession(
    websocket: ReconnectingWebSocketLike,
    session: HostDaemonSessionOpenResponse,
    sequencer: HostDaemonWsSequencer,
  ): void {
    this.clearResumeDeadline();
    this.sessionInvalidationInProgress = false;
    this.socketReady = true;
    for (const frame of sequencer.replayFrom(0)) {
      if (!this.sendFrame(websocket, frame)) {
        return;
      }
    }
    this.resetHeartbeat();
    this.options.logger.info(
      { sessionId: session.sessionId },
      "Reconnected; resuming the server session",
    );
    this.flushSocketPayloads(true);
  }

  private startResumeDeadline(session: HostDaemonSessionOpenResponse): void {
    this.resumeDeadline = setTimeout(() => {
      this.resumeDeadline = null;
      if (this.socketReady || this.session !== session) {
        return;
      }
      this.options.logger.info(
        {
          reconnectGraceMs: session.reconnectGraceMs,
          sessionId: session.sessionId,
        },
        "Could not resume the server session within its grace period",
      );
      this.abandonSession();
    }, session.reconnectGraceMs);
  }

  private clearResumeDeadline(): void {
    if (this.resumeDeadline !== null) {
      clearTimeout(this.resumeDeadline);
      this.resumeDeadline = null;
    }
  }

  private abandonSession(): void {
    this.clearResumeDeadline();
    this.clearSocketPayloads();
    this.sentRecoverableMessages.clear();
    this.sequencer = null;
    this.sessionSocketOpened = false;
    this.socketReady = false;
    this.clearSession();
  }

  private flushPendingRecoverableMessages(): void {
    for (const [key, message] of Array.from(
      this.pendingRecoverableMessages.entries(),
    )) {
      if (this.sentRecoverableMessages.get(key)?.message === message) {
        continue;
      }
      if (!this.sendMessage(message)) {
        return;
      }
    }
  }

  private pruneAcknowledgedRecoverableMessages(acknowledgedSeq: number): void {
    for (const [key, sent] of this.sentRecoverableMessages) {
      if (sent.seq > acknowledgedSeq) {
        continue;
      }
      this.sentRecoverableMessages.delete(key);
      if (this.pendingRecoverableMessages.get(key) === sent.message) {
        this.pendingRecoverableMessages.delete(key);
      }
    }
  }

  private handleWebSocketMessage(data: unknown): void {
    const sequencer = this.sequencer;
    if (sequencer === null) {
      return;
    }
    const received = sequencer.receive(decodeWebSocketMessageData(data));
    this.pruneAcknowledgedRecoverableMessages(sequencer.acknowledgedSeq);
    if (received.kind === "invalid") {
      this.handleInvalidServerMessage({
        data,
        error: new Error("Invalid server websocket frame"),
      });
      return;
    }
    if (received.kind === "gap") {
      this.options.logger.warn(
        { sessionId: this.session?.sessionId ?? null },
        "Server websocket messages arrived out of sequence; opening a new session",
      );
      this.clearHeartbeat();
      this.abandonSession();
      this.websocket?.reconnect(1000, "sequence-gap");
      return;
    }
    if (received.kind === "ignored") {
      return;
    }
    const websocket = this.connectedWebSocket();
    if (websocket !== null && sequencer.ackDue) {
      this.sendFrame(websocket, sequencer.encodeAck());
    }
    this.handleServerMessage(received.message, data);
  }

  private handleServerMessage(decoded: unknown, data: unknown): void {
    const message = hostDaemonServerWsMessageSchema.safeParse(decoded);
    if (!message.success) {
      const invalidRpcRequest =
        invalidHostRpcRequestEnvelopeSchema.safeParse(decoded);
      if (invalidRpcRequest.success) {
        this.options.logger.warn(
          {
            commandType: invalidRpcRequest.data.command.type,
            err: message.error,
            requestId: invalidRpcRequest.data.requestId,
          },
          "Rejected invalid host RPC command",
        );
        this.sendMessage({
          type: "host-rpc.response",
          requestId: invalidRpcRequest.data.requestId,
          commandType: invalidRpcRequest.data.command.type,
          ok: false,
          errorCode: "invalid_command",
          errorMessage: "Invalid host RPC command",
        });
        return;
      }
      this.handleInvalidServerMessage({ data, error: message.error });
      return;
    }

    if (message.data.type === "session-close") {
      this.handleSessionCloseMessage(message.data.reason);
      return;
    }

    if (message.data.type === "interactive-requests.end") {
      this.options.onInteractiveRequestsEnded?.({
        reason: message.data.reason,
        requests: message.data.requests,
      });
      return;
    }

    if (message.data.type === "machine.shutdown") {
      void Promise.resolve(this.options.onMachineShutdown?.()).catch(
        (error) => {
          this.options.logger.error(
            { ...runtimeErrorLogFields(error) },
            "Machine shutdown failed",
          );
        },
      );
      return;
    }

    if (message.data.type === "server.moved") {
      const move = message.data;
      void Promise.resolve(
        this.options.onServerMoved?.({
          serverUrl: move.serverUrl,
          headers: move.headers,
          source: "message",
        }),
      ).catch((error) => {
        this.options.logger.error(
          { ...runtimeErrorLogFields(error), serverUrl: move.serverUrl },
          "Failed to switch this daemon to the moved bb server",
        );
      });
      return;
    }

    if (message.data.type === "provider-session-policy.replace") {
      this.options.onIdleProviderSessionTimeout?.(
        message.data.idleProviderSessionTimeoutMinutes,
      );
      this.options.onAgentCpuPriority?.(message.data.agentCpuPriority);
      return;
    }

    if (message.data.type === "machine-environment.replace") {
      if (message.data.environment.revision > this.machineEnvironmentRevision) {
        this.machineEnvironmentRevision = message.data.environment.revision;
        this.options.onMachineEnvironment?.(message.data.environment);
      }
      return;
    }

    if (message.data.type === "heartbeat-ack") {
      if (this.session !== null) {
        this.lastHeartbeatAcknowledgedAt = Date.now();
      }
      return;
    }

    if (message.data.type === "host-rpc.request") {
      const rpcRequest = message.data;
      void Promise.resolve(this.options.onHostRpcRequest?.(rpcRequest)).catch(
        (error) => {
          this.options.logger.warn(
            {
              commandType: rpcRequest.command.type,
              ...runtimeErrorLogFields(error),
            },
            "Online host RPC handler failed",
          );
        },
      );
      return;
    }

    if (message.data.type === "host-rpc.cancel") {
      this.options.onHostRpcCancel?.(message.data);
      return;
    }

    if (message.data.type === "watch-set.replace") {
      const watchSetMessage = message.data;
      void Promise.resolve(
        this.options.onWatchSetReplace?.(watchSetMessage),
      ).catch((error) => {
        this.options.logger.warn(
          {
            generation: watchSetMessage.generation,
            ...runtimeErrorLogFields(error),
          },
          "Watch set handler failed",
        );
      });
      return;
    }

    if (message.data.type === "connect-shares.replace") {
      const sharesMessage = message.data;
      void Promise.resolve(
        this.options.onConnectSharesReplace?.(sharesMessage),
      ).catch((error) => {
        this.options.logger.warn(
          {
            generation: sharesMessage.generation,
            ...runtimeErrorLogFields(error),
          },
          "Connect shares handler failed",
        );
      });
      return;
    }

    if (message.data.type === "connect-next.replace") {
      const nextMessage = message.data;
      try {
        this.options.onConnectNextReplace?.(nextMessage);
      } catch (error) {
        this.options.logger.warn(
          {
            generation: nextMessage.generation,
            ...runtimeErrorLogFields(error),
          },
          "Connect next handler failed",
        );
      }
      return;
    }

    void Promise.resolve(this.options.onTerminalMessage?.(message.data)).catch(
      (error) => {
        this.options.logger.warn(
          {
            type: message.data.type,
            ...runtimeErrorLogFields(error),
          },
          "Terminal websocket message handler failed",
        );
      },
    );
  }

  private handleSessionCloseMessage(
    reason: HostDaemonSessionCloseReason,
  ): void {
    if (reason === "expired") {
      this.options.logger.info(
        { sessionId: this.session?.sessionId ?? null },
        "Server expired host daemon session; reconnecting",
      );
      this.clearHeartbeat();
      this.abandonSession();
      this.websocket?.reconnect(1000, "expired");
      return;
    }

    void Promise.resolve(this.sessionCloseHandler?.(reason)).catch(
      () => undefined,
    );
    this.shutdownAfterServerMessage(
      "Failed to close server-requested websocket connection",
    );
  }

  private handleInvalidServerMessage(args: InvalidServerMessageArgs): void {
    this.options.logger.error(
      {
        err: args.error,
        ...summarizeServerMessagePayload(args.data),
      },
      "Invalid server websocket message; closing connection",
    );

    void Promise.resolve(this.sessionCloseHandler?.("daemon-disconnect")).catch(
      (error) => {
        this.options.logger.error(
          { err: error },
          "Failed to handle invalid server message shutdown",
        );
      },
    );
    this.shutdownAfterServerMessage(
      "Failed to close invalid server websocket connection",
    );
  }

  private shutdownAfterServerMessage(logMessage: string): void {
    void this.shutdown().catch((error) => {
      this.options.logger.error({ err: error }, logMessage);
    });
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();

    if (!this.session) {
      return;
    }

    const startedAt = Date.now();
    this.lastHeartbeatAcknowledgedAt = startedAt;
    this.lastHeartbeatTickAt = startedAt;
    this.heartbeatInterval = setInterval(() => {
      const session = this.session;
      if (!session) {
        return;
      }
      const now = Date.now();
      const lastTickAt = this.lastHeartbeatTickAt;
      if (lastTickAt !== null) {
        const gapMs = now - lastTickAt;
        const thresholdMs = session.leaseTimeoutMs / 2;
        if (gapMs > session.leaseTimeoutMs) {
          this.lastHeartbeatAcknowledgedAt = now;
        }
        const resumedAfterSuspension = isLikelySystemSuspensionDelay({
          gapMs,
          intervalMs: session.heartbeatIntervalMs,
        });
        if (resumedAfterSuspension) {
          this.options.logger.info(
            {
              gapMs,
              heartbeatIntervalMs: session.heartbeatIntervalMs,
              leaseTimeoutMs: session.leaseTimeoutMs,
              sessionId: session.sessionId,
              websocketReadyState: this.websocket?.readyState ?? null,
            },
            "Host daemon resumed after likely system suspension",
          );
        } else if (gapMs > thresholdMs) {
          this.options.logger.warn(
            {
              gapMs,
              heartbeatIntervalMs: session.heartbeatIntervalMs,
              leaseTimeoutMs: session.leaseTimeoutMs,
              sessionId: session.sessionId,
              websocketReadyState: this.websocket?.readyState ?? null,
            },
            "Host daemon heartbeat timer delayed",
          );
        }
      }
      this.lastHeartbeatTickAt = now;

      const websocket = this.connectedWebSocket();
      if (websocket === null) {
        return;
      }

      const lastAcknowledgedAt = this.lastHeartbeatAcknowledgedAt;
      if (
        lastAcknowledgedAt !== null &&
        now - lastAcknowledgedAt > session.leaseTimeoutMs
      ) {
        this.options.logger.warn(
          {
            lastAcknowledgedAt,
            leaseTimeoutMs: session.leaseTimeoutMs,
            sessionId: session.sessionId,
          },
          "Server heartbeat acknowledgements stopped; reconnecting",
        );
        this.clearHeartbeat();
        websocket.reconnect(1013, "heartbeat-ack-timeout");
        return;
      }

      this.sendMessage({ type: "heartbeat" });
    }, this.session.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.lastHeartbeatAcknowledgedAt = null;
    this.lastHeartbeatTickAt = null;
  }

  private clearSession(): void {
    if (!this.session) {
      return;
    }

    this.session = null;
    this.options.setSession?.(null);
  }

  private buildWebSocketUrl(
    sessionId: string,
    resumeFrom: number | null,
  ): string {
    const serverUrl = new URL(this.options.serverUrl);
    serverUrl.protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:";
    serverUrl.pathname = "/internal/ws";
    serverUrl.searchParams.set("sessionId", sessionId);
    if (resumeFrom !== null) {
      serverUrl.searchParams.set(
        HOST_DAEMON_WS_RESUME_FROM_QUERY_PARAM,
        String(resumeFrom),
      );
    }
    return serverUrl.toString();
  }
}
