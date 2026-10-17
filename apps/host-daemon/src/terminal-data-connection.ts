import { Buffer } from "node:buffer";
import {
  buildHostDaemonWebSocketAuthorizationHeader,
  buildHostDaemonWebSocketProtocols,
  hostDaemonTerminalDataServerMessageSchema,
  hostDaemonTerminalDataDaemonMessageSchema,
  type HostDaemonTerminalDataDaemonMessage,
} from "@bb/host-daemon-contract";
import { runtimeErrorLogFields } from "./error-utils.js";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_RECONNECTION_DELAY,
  DEFAULT_MIN_RECONNECTION_DELAY,
  DEFAULT_RECONNECTION_DELAY_GROW_FACTOR,
  OPEN_READY_STATE,
  createDefaultReconnectingWebSocket,
  decodeWebSocketMessageData,
  type HostDaemonTerminalDataConnectionOptions,
  type ReconnectingWebSocketLike,
} from "./server-connection-support.js";

const HIGH_WATER_BYTES = 1024 * 1024;
const MAX_QUEUE_BYTES = 32 * 1024 * 1024;
const DRAIN_POLL_MS = 10;

export class TerminalDataConnection {
  private websocket: ReconnectingWebSocketLike | null = null;
  private sessionId: string | null = null;
  private pendingBytes = 0;
  private readonly pendingOutput: { bytes: number; payload: string }[] = [];
  private readonly pendingExits = new Map<
    string,
    HostDaemonTerminalDataDaemonMessage & { type: "terminal.exited" }
  >();
  private drainTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: HostDaemonTerminalDataConnectionOptions,
  ) {}

  connect(sessionId: string): void {
    this.close();
    this.sessionId = sessionId;
    const websocket = (
      this.options.createWebSocket ?? createDefaultReconnectingWebSocket
    )(() => this.options.urlProvider(sessionId), {
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
    });
    this.websocket = websocket;
    websocket.onopen = () => {
      this.flushOutput(true);
    };
    websocket.onmessage = (event) => {
      let decoded: unknown;
      try {
        decoded = JSON.parse(decodeWebSocketMessageData(event.data));
      } catch (error) {
        this.options.logger.warn(
          { ...runtimeErrorLogFields(error) },
          "Invalid terminal data websocket message",
        );
        return;
      }
      const parsed =
        hostDaemonTerminalDataServerMessageSchema.safeParse(decoded);
      if (!parsed.success) {
        this.options.logger.warn(
          { err: parsed.error },
          "Invalid terminal data websocket message",
        );
        return;
      }
      if (parsed.data.type === "terminal.exited.ack") {
        this.pendingExits.delete(parsed.data.terminalId);
        return;
      }
      void Promise.resolve(this.options.onMessage(parsed.data)).then(
        () => {
          if (parsed.data.type !== "terminal.attach") return;
          const exit = this.pendingExits.get(parsed.data.terminalId);
          if (exit) this.sendMessage(exit);
        },
        (error: unknown) => {
          this.options.logger.warn(
            { ...runtimeErrorLogFields(error) },
            "Terminal data handler failed",
          );
        },
      );
    };
    websocket.onclose = () => {
      this.clearOutput();
    };
    websocket.onerror = (error) => {
      this.options.logger.warn({ err: error }, "Terminal data websocket error");
    };
  }

  close(): void {
    this.sessionId = null;
    this.clearOutput();
    this.pendingExits.clear();
    if (this.websocket) {
      const websocket = this.websocket;
      this.websocket = null;
      websocket.onopen = null;
      websocket.onmessage = null;
      websocket.onclose = null;
      websocket.onerror = null;
      websocket.close();
    }
  }

  sendMessage(message: HostDaemonTerminalDataDaemonMessage): boolean {
    const parsed = hostDaemonTerminalDataDaemonMessageSchema.parse(message);
    if (parsed.type === "terminal.exited" && this.sessionId !== null)
      this.pendingExits.set(parsed.terminalId, parsed);
    const websocket = this.websocket;
    if (!websocket || websocket.readyState !== OPEN_READY_STATE) return false;
    const payload = JSON.stringify(parsed);
    if (
      parsed.type === "terminal.output" &&
      (this.pendingOutput.length > 0 ||
        (websocket.bufferedAmount ?? 0) > HIGH_WATER_BYTES)
    ) {
      const bytes = Buffer.byteLength(payload, "utf8");
      if (this.pendingBytes + bytes > MAX_QUEUE_BYTES) {
        this.options.logger.warn(
          { maxQueueBytes: MAX_QUEUE_BYTES, pendingBytes: this.pendingBytes },
          "Terminal websocket output queue exceeded its limit",
        );
        this.clearOutput();
        this.reconnectSocket(websocket, "terminal-backpressure");
        return false;
      }
      this.pendingOutput.push({ bytes, payload });
      this.pendingBytes += bytes;
      this.scheduleDrain();
      return true;
    }
    if (parsed.type !== "terminal.output" && this.pendingOutput.length > 0) {
      this.flushOutput(true);
      if (
        this.pendingOutput.length > 0 ||
        websocket.readyState !== OPEN_READY_STATE
      ) {
        if (parsed.type === "terminal.exited")
          this.pendingExits.set(parsed.terminalId, parsed);
        return false;
      }
    }
    try {
      websocket.send(payload);
    } catch (error) {
      this.options.logger.warn(
        { ...runtimeErrorLogFields(error), type: parsed.type },
        "Failed to send terminal data websocket message",
      );
      if (parsed.type === "terminal.exited")
        this.pendingExits.set(parsed.terminalId, parsed);
      this.reconnectSocket(websocket, "send-failed");
      return false;
    }
    return true;
  }

  private scheduleDrain(): void {
    if (this.drainTimeout !== null) return;
    this.drainTimeout = setTimeout(() => {
      this.drainTimeout = null;
      this.flushOutput(false);
    }, DRAIN_POLL_MS);
  }

  private flushOutput(ignoreHighWater: boolean): void {
    const websocket = this.websocket;
    if (!websocket || websocket.readyState !== OPEN_READY_STATE) {
      this.clearOutput();
      return;
    }
    while (
      this.pendingOutput.length > 0 &&
      (ignoreHighWater || (websocket.bufferedAmount ?? 0) <= HIGH_WATER_BYTES)
    ) {
      const pending = this.pendingOutput[0];
      if (!pending) break;
      try {
        websocket.send(pending.payload);
      } catch (error) {
        this.options.logger.warn(
          { ...runtimeErrorLogFields(error) },
          "Failed to drain terminal websocket output",
        );
        this.reconnectSocket(websocket, "send-failed");
        this.clearOutput();
        return;
      }
      this.pendingOutput.shift();
      this.pendingBytes -= pending.bytes;
    }
    if (this.pendingOutput.length > 0) this.scheduleDrain();
    else this.clearOutput();
  }

  private reconnectSocket(
    websocket: ReconnectingWebSocketLike,
    reason: string,
  ): void {
    if (websocket.reconnect) websocket.reconnect(1013, reason);
    else websocket.close(1013, reason);
  }

  private clearOutput(): void {
    clearTimeout(this.drainTimeout ?? undefined);
    this.drainTimeout = null;
    this.pendingOutput.length = 0;
    this.pendingBytes = 0;
  }
}
