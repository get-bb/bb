import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  hostDaemonTerminalDataDaemonMessageSchema,
  type HostDaemonTerminalDataDaemonMessage,
  type HostDaemonTerminalDataServerMessage,
} from "@bb/host-daemon-contract";
import {
  terminalClientMessageSchema,
  terminalServerMessageSchema,
  type TerminalClientMessage,
  type TerminalServerMessage,
  type TerminalSession,
} from "@bb/server-contract";
import { parseSocketMessage } from "../../ws/decode-payload.js";
import {
  PendingRpcRegistry,
  type PendingRpcKey,
} from "./pending-rpc-registry.js";
import { TerminalOutputFlowControl } from "./terminal-output-flow-control.js";

const BROWSER_TERMINAL_REPLAY_MAX_BYTES = 512 * 1024;
const DEFAULT_ATTACH_TIMEOUT_MS = 10_000;
const TERMINAL_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
const TERMINAL_SOCKET_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
const TERMINAL_SOCKET_DRAIN_POLL_MS = 10;

type TerminalReplayMessage = Extract<
  HostDaemonTerminalDataDaemonMessage,
  { type: "terminal.replay" }
>;
type TerminalOutputChunk = Extract<
  HostDaemonTerminalDataDaemonMessage,
  { type: "terminal.output" }
>["chunk"];

export interface TerminalRelaySocket {
  close(code?: number, reason?: string): void;
  raw?: { bufferedAmount: number };
  send(data: string): void;
}

export interface TerminalRelayTerminal {
  daemonSessionId: string | null;
  session: TerminalSession;
}

export interface TerminalRelaySessionUpdate {
  kind: "exited" | "session-updated";
  terminal: TerminalRelayTerminal;
}

export type TerminalUpgradeGrant =
  | {
      kind: "browser";
      outputAcks: boolean;
      sinceSeq: number;
      terminal: TerminalRelayTerminal | null;
      terminalId: string;
    }
  | { kind: "daemon"; daemonSessionId: string };

export interface TerminalRelayHost {
  recordInput(args: { hasData: boolean; terminalId: string }): void;
  recordResize(args: { cols: number; rows: number; terminalId: string }): void;
  sendDaemonControlMessage(args: {
    daemonSessionId: string;
    message: HostDaemonTerminalDataServerMessage;
  }): void;
}

export interface TerminalRelayControl {
  closeDaemonSession(daemonSessionId: string): void;
  handleDaemonControlMessage(args: {
    daemonSessionId: string;
    message: HostDaemonTerminalDataDaemonMessage;
  }): void;
  publishSession(update: TerminalRelaySessionUpdate): void;
}

interface RelayTerminalState {
  catchingUp: boolean;
  clients: Set<TerminalRelaySocket>;
  daemonSessionId: string | null;
  nextSeq: number | null;
  pendingSockets: Set<TerminalRelaySocket>;
  resizeOwner: TerminalRelaySocket | null;
  session: TerminalSession;
}

interface PendingCatchUpKey extends PendingRpcKey {
  terminalId: string;
}

interface PendingAttachKey extends PendingCatchUpKey {
  sinceSeq: number;
  socket: TerminalRelaySocket;
}

interface SocketSendQueue {
  bytes: number;
  payloads: string[];
  timeout: ReturnType<typeof setTimeout> | null;
}

class TerminalRelayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TERMINAL_ATTACH_CANCELLED = new TerminalRelayError(
  "terminal_attach_cancelled",
  "Terminal attach cancelled",
);
const TERMINAL_ATTACH_HELD = new TerminalRelayError(
  "host_disconnected",
  "Host disconnected from terminal session",
);

export function terminalRpcKey(
  daemonSessionId: string,
  terminalId: string,
  requestId: string,
): string {
  return `${daemonSessionId}\0${terminalId}\0${requestId}`;
}

function decodeSocketText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString(
      "utf8",
    );
  }
  return String(raw);
}

export class TerminalRelay implements TerminalRelayControl {
  private host: TerminalRelayHost | null = null;
  private readonly terminals = new Map<string, RelayTerminalState>();
  private readonly terminalIdBySocket = new Map<TerminalRelaySocket, string>();
  private readonly daemonSockets = new Map<string, TerminalRelaySocket>();
  private readonly sendQueues = new Map<TerminalRelaySocket, SocketSendQueue>();
  private readonly outputAckSocketVisibility = new WeakMap<
    TerminalRelaySocket,
    boolean
  >();
  private readonly outputFlow: TerminalOutputFlowControl;
  private readonly pendingAttaches: PendingRpcRegistry<
    PendingAttachKey,
    TerminalReplayMessage
  >;
  private readonly pendingCatchUps: PendingRpcRegistry<
    PendingCatchUpKey,
    TerminalReplayMessage
  >;

  constructor(options: { attachTimeoutMs?: number } = {}) {
    const timeoutMs = options.attachTimeoutMs ?? DEFAULT_ATTACH_TIMEOUT_MS;
    this.outputFlow = new TerminalOutputFlowControl({
      sendDaemonMessage: (daemonSessionId, message) =>
        this.sendToDaemon(daemonSessionId, message),
    });
    this.pendingAttaches = new PendingRpcRegistry({
      onFail: (key, error) => this.failAttach(key, error),
      onSettle: (key, replay) => this.completeAttach(key, replay),
      timeoutMs,
      timeoutError: () =>
        new TerminalRelayError(
          "terminal_attach_timeout",
          "Timed out attaching terminal session",
        ),
    });
    this.pendingCatchUps = new PendingRpcRegistry({
      onFail: (key) => this.finishCatchUp(key, null),
      onSettle: (key, replay) => this.finishCatchUp(key, replay),
      timeoutMs,
      timeoutError: () =>
        new TerminalRelayError(
          "terminal_catch_up_timeout",
          "Timed out replaying terminal output after the host reconnected",
        ),
    });
  }

  bindHost(host: TerminalRelayHost): void {
    this.host = host;
  }

  open(grant: TerminalUpgradeGrant, socket: TerminalRelaySocket): void {
    if (grant.kind === "daemon") {
      const previous = this.daemonSockets.get(grant.daemonSessionId);
      this.daemonSockets.set(grant.daemonSessionId, socket);
      previous?.close(1000, "replaced");
      return;
    }
    this.openBrowser(grant, socket);
  }

  message(
    grant: TerminalUpgradeGrant,
    socket: TerminalRelaySocket,
    raw: unknown,
  ): void {
    if (grant.kind === "daemon") {
      this.handleDaemonSocketMessage(grant.daemonSessionId, raw);
      return;
    }
    const message = parseSocketMessage(
      socket,
      raw,
      terminalClientMessageSchema,
    );
    if (message !== null) {
      this.handleBrowserMessage(grant.terminalId, socket, message);
    }
  }

  close(grant: TerminalUpgradeGrant, socket: TerminalRelaySocket): void {
    if (grant.kind === "daemon") {
      if (this.daemonSockets.get(grant.daemonSessionId) === socket) {
        this.daemonSockets.delete(grant.daemonSessionId);
      }
      return;
    }
    this.detachBrowser(grant.terminalId, socket);
  }

  publishSession(update: TerminalRelaySessionUpdate): void {
    const { session, daemonSessionId } = update.terminal;
    const state = this.terminals.get(session.id);
    if (!state) {
      return;
    }
    const wasRunningOn =
      state.session.status === "running" ? state.daemonSessionId : null;
    state.session = session;
    state.daemonSessionId = daemonSessionId;
    if (update.kind === "exited") {
      state.nextSeq = null;
      this.outputFlow.forgetTerminal(session.id);
      this.failPendingForTerminal(
        session.id,
        new TerminalRelayError("terminal_exited", "Terminal session exited"),
      );
      this.broadcast(state, { type: "exited", session });
      this.prune(state);
      return;
    }
    this.broadcast(state, { type: "session-updated", session });
    if (session.status === "disconnected") {
      this.failPendingForTerminal(session.id, TERMINAL_ATTACH_HELD);
      return;
    }
    if (
      session.status === "running" &&
      daemonSessionId !== null &&
      wasRunningOn !== daemonSessionId
    ) {
      this.requestCatchUp(state, daemonSessionId);
    }
  }

  handleDaemonControlMessage(args: {
    daemonSessionId: string;
    message: HostDaemonTerminalDataDaemonMessage;
  }): void {
    this.handleDaemonData(args.daemonSessionId, args.message);
  }

  closeDaemonSession(daemonSessionId: string): void {
    const socket = this.daemonSockets.get(daemonSessionId);
    this.daemonSockets.delete(daemonSessionId);
    socket?.close(1000, "session-closed");
  }

  private openBrowser(
    grant: Extract<TerminalUpgradeGrant, { kind: "browser" }>,
    socket: TerminalRelaySocket,
  ): void {
    if (grant.outputAcks) {
      this.outputAckSocketVisibility.set(socket, true);
    }
    const terminal = grant.terminal;
    if (terminal === null) {
      this.sendError(socket, "terminal_not_found", "Terminal session not found");
      socket.close(1008, "terminal_not_found");
      return;
    }
    const state = this.trackTerminal(terminal);
    const { session } = terminal;
    if (session.status === "disconnected") {
      this.holdBrowser(state, socket, grant.sinceSeq);
      return;
    }
    if (session.status !== "running" || terminal.daemonSessionId === null) {
      this.sendToSocket(socket, {
        type: "attached",
        session,
        replayStartSeq: 0,
        nextSeq: 0,
      });
      if (session.status === "exited") {
        this.sendToSocket(socket, { type: "exited", session });
      } else {
        this.sendError(
          socket,
          "terminal_not_running",
          "Terminal session is not running",
        );
      }
      this.prune(state);
      return;
    }

    state.resizeOwner = socket;
    state.pendingSockets.add(socket);
    this.terminalIdBySocket.set(socket, session.id);
    const requestId = randomUUID();
    void this.pendingAttaches
      .claim({
        rpcKey: terminalRpcKey(terminal.daemonSessionId, session.id, requestId),
        sinceSeq: grant.sinceSeq,
        socket,
        terminalId: session.id,
      })
      .promise.catch(() => undefined);
    this.sendToDaemon(terminal.daemonSessionId, {
      type: "terminal.attach",
      requestId,
      terminalId: session.id,
      sinceSeq: grant.sinceSeq,
      tailBytes: BROWSER_TERMINAL_REPLAY_MAX_BYTES,
    });
  }

  private trackTerminal(terminal: TerminalRelayTerminal): RelayTerminalState {
    const existing = this.terminals.get(terminal.session.id);
    if (existing) {
      existing.session = terminal.session;
      existing.daemonSessionId = terminal.daemonSessionId;
      return existing;
    }
    const state: RelayTerminalState = {
      catchingUp: false,
      clients: new Set(),
      daemonSessionId: terminal.daemonSessionId,
      nextSeq: null,
      pendingSockets: new Set(),
      resizeOwner: null,
      session: terminal.session,
    };
    this.terminals.set(terminal.session.id, state);
    return state;
  }

  private holdBrowser(
    state: RelayTerminalState,
    socket: TerminalRelaySocket,
    sinceSeq: number,
  ): void {
    this.addClient(state, socket, sinceSeq);
    this.sendToSocket(socket, {
      type: "attached",
      session: state.session,
      replayStartSeq: sinceSeq,
      nextSeq: sinceSeq,
    });
  }

  private addClient(
    state: RelayTerminalState,
    socket: TerminalRelaySocket,
    nextSeq: number,
  ): void {
    state.clients.add(socket);
    this.terminalIdBySocket.set(socket, state.session.id);
    state.nextSeq = Math.max(state.nextSeq ?? 0, nextSeq);
    const visible = this.outputAckSocketVisibility.get(socket);
    if (visible !== undefined) {
      this.outputFlow.addClient(state.session.id, socket, nextSeq, visible);
    }
  }

  private completeAttach(
    key: PendingAttachKey,
    replay: TerminalReplayMessage,
  ): void {
    const state = this.terminals.get(key.terminalId);
    if (!state) {
      this.sendError(
        key.socket,
        "terminal_not_found",
        "Terminal session not found",
      );
      return;
    }
    state.pendingSockets.delete(key.socket);
    this.addClient(state, key.socket, replay.nextSeq);
    this.sendToSocket(key.socket, {
      type: "attached",
      session: state.session,
      replayStartSeq: replay.replayStartSeq,
      nextSeq: replay.nextSeq,
    });
    for (const chunk of replay.chunks) {
      this.sendToSocket(key.socket, {
        type: "output",
        chunk: { seq: chunk.seq, dataBase64: chunk.dataBase64 },
      });
    }
  }

  private failAttach(key: PendingAttachKey, error: Error): void {
    const state = this.terminals.get(key.terminalId);
    state?.pendingSockets.delete(key.socket);
    if (error === TERMINAL_ATTACH_CANCELLED) {
      return;
    }
    if (error === TERMINAL_ATTACH_HELD && state) {
      this.holdBrowser(state, key.socket, key.sinceSeq);
      return;
    }
    if (state) {
      this.releaseResizeOwner(state, key.socket);
    }
    this.sendError(
      key.socket,
      error instanceof TerminalRelayError ? error.code : "terminal_attach_failed",
      error.message,
    );
    if (state) {
      this.prune(state);
    }
  }

  private requestCatchUp(
    state: RelayTerminalState,
    daemonSessionId: string,
  ): void {
    if (state.nextSeq === null || state.clients.size === 0) {
      return;
    }
    const requestId = randomUUID();
    state.catchingUp = true;
    void this.pendingCatchUps
      .claim({
        rpcKey: terminalRpcKey(daemonSessionId, state.session.id, requestId),
        terminalId: state.session.id,
      })
      .promise.catch(() => undefined);
    this.sendToDaemon(daemonSessionId, {
      type: "terminal.attach",
      requestId,
      terminalId: state.session.id,
      sinceSeq: state.nextSeq,
      tailBytes: BROWSER_TERMINAL_REPLAY_MAX_BYTES,
    });
  }

  private finishCatchUp(
    key: PendingCatchUpKey,
    replay: TerminalReplayMessage | null,
  ): void {
    const state = this.terminals.get(key.terminalId);
    if (!state) {
      return;
    }
    state.catchingUp = false;
    for (const chunk of replay?.chunks ?? []) {
      this.forwardOutput(state, chunk);
    }
  }

  private failPendingForTerminal(terminalId: string, error: Error): void {
    this.pendingCatchUps.failAllMatching(
      (key) => key.terminalId === terminalId,
      error,
    );
    this.pendingAttaches.failAllMatching(
      (key) => key.terminalId === terminalId,
      error,
    );
  }

  private detachBrowser(terminalId: string, socket: TerminalRelaySocket): void {
    this.terminalIdBySocket.delete(socket);
    this.clearSendQueue(socket);
    this.outputFlow.removeClient(terminalId, socket);
    this.pendingAttaches.failAllMatching(
      (key) => key.terminalId === terminalId && key.socket === socket,
      TERMINAL_ATTACH_CANCELLED,
    );
    const state = this.terminals.get(terminalId);
    if (!state) {
      return;
    }
    state.clients.delete(socket);
    this.releaseResizeOwner(state, socket);
    this.prune(state);
  }

  private releaseResizeOwner(
    state: RelayTerminalState,
    socket: TerminalRelaySocket,
  ): void {
    if (state.resizeOwner !== socket) {
      return;
    }
    let replacement: TerminalRelaySocket | null = null;
    for (const candidate of state.clients) {
      if (candidate !== socket) {
        replacement = candidate;
      }
    }
    state.resizeOwner = replacement;
  }

  private prune(state: RelayTerminalState): void {
    if (state.clients.size > 0 || state.pendingSockets.size > 0) {
      return;
    }
    this.terminals.delete(state.session.id);
  }

  private handleBrowserMessage(
    terminalId: string,
    socket: TerminalRelaySocket,
    message: TerminalClientMessage,
  ): void {
    switch (message.type) {
      case "ping":
        this.sendToSocket(socket, { type: "pong" });
        return;
      case "input": {
        const target = this.runningTarget(terminalId, socket);
        if (target === null) {
          return;
        }
        this.sendToDaemon(target.daemonSessionId, {
          type: "terminal.input",
          terminalId,
          dataBase64: message.dataBase64,
        });
        this.host?.recordInput({
          hasData: message.dataBase64.length > 0,
          terminalId,
        });
        return;
      }
      case "resize": {
        if (this.terminals.get(terminalId)?.resizeOwner !== socket) {
          return;
        }
        const target = this.runningTarget(terminalId, socket);
        if (target === null) {
          return;
        }
        if (
          target.state.session.cols !== message.cols ||
          target.state.session.rows !== message.rows
        ) {
          this.host?.recordResize({
            cols: message.cols,
            rows: message.rows,
            terminalId,
          });
        }
        this.sendToDaemon(target.daemonSessionId, {
          type: "terminal.resize",
          terminalId,
          cols: message.cols,
          rows: message.rows,
        });
        return;
      }
      case "ack":
        this.outputFlow.acknowledge(terminalId, socket, message.nextSeq);
        return;
      case "visibility":
        if (this.outputAckSocketVisibility.has(socket)) {
          this.outputAckSocketVisibility.set(socket, message.visible);
        }
        this.outputFlow.setVisible(terminalId, socket, message.visible);
        return;
    }
  }

  private runningTarget(
    terminalId: string,
    socket: TerminalRelaySocket,
  ): { daemonSessionId: string; state: RelayTerminalState } | null {
    const state = this.terminals.get(terminalId);
    if (!state) {
      this.sendError(socket, "terminal_not_found", "Terminal session not found");
      return null;
    }
    if (state.session.status !== "running" || state.daemonSessionId === null) {
      if (state.session.status !== "disconnected") {
        this.sendError(
          socket,
          "terminal_not_running",
          "Terminal session is not running",
        );
      }
      return null;
    }
    return { daemonSessionId: state.daemonSessionId, state };
  }

  private handleDaemonSocketMessage(daemonSessionId: string, raw: unknown): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeSocketText(raw));
    } catch {
      return;
    }
    const message = hostDaemonTerminalDataDaemonMessageSchema.safeParse(decoded);
    if (message.success) {
      this.handleDaemonData(daemonSessionId, message.data);
    }
  }

  private handleDaemonData(
    daemonSessionId: string,
    message: HostDaemonTerminalDataDaemonMessage,
  ): void {
    switch (message.type) {
      case "terminal.output": {
        this.outputFlow.recordOutput(
          message.terminalId,
          daemonSessionId,
          message.chunk.seq,
        );
        const state = this.terminals.get(message.terminalId);
        if (
          state?.session.status !== "running" ||
          state.daemonSessionId !== daemonSessionId ||
          state.catchingUp
        ) {
          return;
        }
        this.forwardOutput(state, message.chunk);
        return;
      }
      case "terminal.replay": {
        const rpcKey = terminalRpcKey(
          daemonSessionId,
          message.terminalId,
          message.requestId,
        );
        if (!this.pendingAttaches.settle(rpcKey, message)) {
          this.pendingCatchUps.settle(rpcKey, message);
        }
        return;
      }
      case "terminal.error": {
        const rpcKey = terminalRpcKey(
          daemonSessionId,
          message.terminalId,
          message.requestId,
        );
        const error = new TerminalRelayError(message.code, message.message);
        if (!this.pendingAttaches.fail(rpcKey, error)) {
          this.pendingCatchUps.fail(rpcKey, error);
        }
        return;
      }
    }
  }

  private forwardOutput(
    state: RelayTerminalState,
    chunk: TerminalOutputChunk,
  ): void {
    if (chunk.seq < (state.nextSeq ?? 0)) {
      return;
    }
    state.nextSeq = chunk.seq + 1;
    this.broadcast(state, {
      type: "output",
      chunk: { seq: chunk.seq, dataBase64: chunk.dataBase64 },
    });
  }

  private sendToDaemon(
    daemonSessionId: string,
    message: HostDaemonTerminalDataServerMessage,
  ): void {
    const socket = this.daemonSockets.get(daemonSessionId);
    if (socket) {
      try {
        socket.send(JSON.stringify(message));
        return;
      } catch {
        this.daemonSockets.delete(daemonSessionId);
      }
    }
    this.host?.sendDaemonControlMessage({ daemonSessionId, message });
  }

  private broadcast(
    state: RelayTerminalState,
    message: TerminalServerMessage,
  ): void {
    if (state.clients.size === 0) {
      return;
    }
    const payload = JSON.stringify(terminalServerMessageSchema.parse(message));
    for (const socket of [...state.clients]) {
      this.sendPayload(socket, payload);
    }
  }

  private sendError(
    socket: TerminalRelaySocket,
    code: string,
    message: string,
  ): void {
    this.sendToSocket(socket, { type: "error", code, message });
  }

  private sendToSocket(
    socket: TerminalRelaySocket,
    message: TerminalServerMessage,
  ): void {
    this.sendPayload(
      socket,
      JSON.stringify(terminalServerMessageSchema.parse(message)),
    );
  }

  private sendPayload(socket: TerminalRelaySocket, payload: string): void {
    const existingQueue = this.sendQueues.get(socket);
    if (
      !existingQueue &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      try {
        socket.send(payload);
      } catch {
        this.dropSocket(socket, "terminal-send-failed");
      }
      return;
    }
    const queue = existingQueue ?? { bytes: 0, payloads: [], timeout: null };
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (queue.bytes + payloadBytes > TERMINAL_SOCKET_MAX_QUEUE_BYTES) {
      this.dropSocket(socket, "terminal-backpressure");
      return;
    }
    queue.payloads.push(payload);
    queue.bytes += payloadBytes;
    this.sendQueues.set(socket, queue);
    this.scheduleDrain(socket, queue);
  }

  private scheduleDrain(socket: TerminalRelaySocket, queue: SocketSendQueue): void {
    if (queue.timeout !== null) {
      return;
    }
    queue.timeout = setTimeout(() => {
      queue.timeout = null;
      this.flushQueue(socket, queue);
    }, TERMINAL_SOCKET_DRAIN_POLL_MS);
  }

  private flushQueue(socket: TerminalRelaySocket, queue: SocketSendQueue): void {
    if (this.sendQueues.get(socket) !== queue) {
      return;
    }
    while (
      queue.payloads.length > 0 &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      const payload = queue.payloads[0];
      if (payload === undefined) {
        break;
      }
      try {
        socket.send(payload);
      } catch {
        this.dropSocket(socket, "terminal-send-failed");
        return;
      }
      queue.payloads.shift();
      queue.bytes -= Buffer.byteLength(payload, "utf8");
    }
    if (queue.payloads.length === 0) {
      this.clearSendQueue(socket);
      return;
    }
    this.scheduleDrain(socket, queue);
  }

  private clearSendQueue(socket: TerminalRelaySocket): void {
    const queue = this.sendQueues.get(socket);
    if (!queue) {
      return;
    }
    if (queue.timeout !== null) {
      clearTimeout(queue.timeout);
    }
    this.sendQueues.delete(socket);
  }

  private dropSocket(socket: TerminalRelaySocket, reason: string): void {
    const terminalId = this.terminalIdBySocket.get(socket);
    if (terminalId !== undefined) {
      this.detachBrowser(terminalId, socket);
    } else {
      this.clearSendQueue(socket);
    }
    try {
      socket.close(1013, reason);
    } catch {}
  }
}
