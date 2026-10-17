import { randomUUID } from "node:crypto";
import type { HostDaemonTerminalDataDaemonMessage } from "@bb/host-daemon-contract/terminal-data";
import type {
  TerminalClientMessage,
  TerminalSession,
} from "@bb/server-contract";
import { TerminalClientRegistry } from "./terminal-client-registry.js";
import type { TerminalDataPlaneHost } from "./terminal-data-plane-host.js";
import { TerminalOutputFlowControl } from "./terminal-output-flow-control.js";
import {
  PendingRpcRegistry,
  type PendingRpcKey,
} from "./pending-rpc-registry.js";

export type TerminalDataPlaneSocket = {
  readonly bufferedAmount: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
};

export type TerminalDataPlaneTerminalState = {
  daemonSessionId: string | null;
  hostId: string;
  session: TerminalSession;
  status: TerminalSession["status"];
};

export type TerminalDaemonDataMessage = HostDaemonTerminalDataDaemonMessage;
export type TerminalCatchUpRequest = {
  daemonSessionId: string;
  force: boolean;
  terminalId: string;
};
type Replay = Extract<TerminalDaemonDataMessage, { type: "terminal.replay" }>;
interface PendingKey extends PendingRpcKey {
  daemonSessionId: string;
  requestId: string;
  terminalId: string;
}
interface PendingAttach extends PendingKey {
  socket: TerminalDataPlaneSocket;
}

const BROWSER_TERMINAL_REPLAY_MAX_BYTES = 512 * 1024;
const TERMINAL_ATTACH_CANCELLED = new Error("Terminal attach cancelled");

class TerminalDataPlaneError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function terminalDataPlaneError(code: string, message: string): TerminalDataPlaneError {
  return new TerminalDataPlaneError(code, message);
}

function errorCode(error: Error, fallback: string): string {
  return error instanceof TerminalDataPlaneError ? error.code : fallback;
}

function rpcKey(
  daemonSessionId: string,
  terminalId: string,
  requestId: string,
): string {
  return `${daemonSessionId}\0${terminalId}\0${requestId}`;
}

export interface TerminalDataPlane {
  attachBrowserClient(args: {
    outputAcks: boolean;
    sinceSeq: number;
    socket: TerminalDataPlaneSocket;
    terminalId: string;
  }): void;
  detachBrowserClient(
    socket: TerminalDataPlaneSocket,
    terminalId: string,
  ): void;
  handleBrowserMessage(args: {
    message: TerminalClientMessage;
    socket: TerminalDataPlaneSocket;
    terminalId: string;
  }): void;
  handleDaemonDataMessage(args: {
    daemonSessionId: string;
    message: TerminalDaemonDataMessage;
  }): void;
  setTerminalState(
    terminalId: string,
    state: TerminalDataPlaneTerminalState | null,
  ): void;
  broadcastSessionUpdated(terminalId: string, session: TerminalSession): void;
  broadcastExited(terminalId: string, session: TerminalSession): void;
  holdForReattach(
    terminalId: string,
    session: TerminalSession,
    socket: TerminalDataPlaneSocket,
    sinceSeq: number,
    outputAcks?: boolean,
  ): void;
  requestCatchUp(args: TerminalCatchUpRequest): void;
  failPendingForDaemonSession(
    daemonSessionId: string,
    reason: "daemon-disconnect",
  ): void;
  failPendingForTerminal(
    terminalId: string,
    code: string,
    message: string,
  ): void;
  forgetTerminal(terminalId: string): void;
  sendSocketMessage(
    socket: TerminalDataPlaneSocket,
    message:
      | { type: "error"; code: string; message: string }
      | {
          type: "attached";
          session: TerminalSession;
          replayStartSeq: number;
          nextSeq: number;
        }
      | { type: "exited"; session: TerminalSession },
  ): void;
}

export class InProcessTerminalDataPlane implements TerminalDataPlane {
  readonly clients = new TerminalClientRegistry();
  private readonly states = new Map<string, TerminalDataPlaneTerminalState>();
  private readonly nextSeqByTerminal = new Map<string, number>();
  private readonly catchingUp = new Set<string>();
  private readonly ackVisibility = new WeakMap<
    TerminalDataPlaneSocket,
    boolean
  >();
  private readonly flow: TerminalOutputFlowControl;
  private readonly pendingAttaches: PendingRpcRegistry<PendingAttach, Replay>;
  private readonly pendingCatchUps: PendingRpcRegistry<PendingKey, Replay>;

  constructor(
    private readonly host: TerminalDataPlaneHost,
    attachTimeoutMs = 10_000,
  ) {
    this.flow = new TerminalOutputFlowControl({
      sendDaemonMessage: (daemonSessionId, message) => {
        this.host.sendDaemonDataMessage(daemonSessionId, message);
      },
    });
    this.pendingAttaches = new PendingRpcRegistry({
      onFail: (pending, error) => {
        if (error === TERMINAL_ATTACH_CANCELLED) return;
        this.clients.unregisterTerminalClient(
          pending.terminalId,
          pending.socket,
        );
        this.sendError(
          pending.socket,
          errorCode(error, "terminal_attach_failed"),
          error.message,
        );
      },
      onSettle: (pending, replay) => this.completeAttach(pending, replay),
      timeoutMs: attachTimeoutMs,
      timeoutError: () =>
        terminalDataPlaneError(
          "terminal_attach_timeout",
          "Timed out attaching terminal session",
        ),
    });
    this.pendingCatchUps = new PendingRpcRegistry({
      onFail: (pending, error) => {
        this.catchingUp.delete(pending.terminalId);
        this.host.onCatchUpError({
          daemonSessionId: pending.daemonSessionId,
          terminalId: pending.terminalId,
          requestId: pending.requestId,
          code: errorCode(error, "terminal_catch_up_failed"),
          message: error.message,
        });
      },
      onSettle: (pending, replay) => {
        this.catchingUp.delete(pending.terminalId);
        for (const chunk of replay.chunks)
          this.forwardOutput(pending.terminalId, chunk);
      },
      timeoutMs: attachTimeoutMs,
      timeoutError: () =>
        terminalDataPlaneError(
          "terminal_catch_up_timeout",
          "Timed out replaying terminal output after the host reconnected",
        ),
    });
  }

  setTerminalState(
    terminalId: string,
    state: TerminalDataPlaneTerminalState | null,
  ): void {
    if (state === null) this.states.delete(terminalId);
    else this.states.set(terminalId, state);
  }

  attachBrowserClient(args: {
    outputAcks: boolean;
    sinceSeq: number;
    socket: TerminalDataPlaneSocket;
    terminalId: string;
  }): void {
    const state = this.states.get(args.terminalId);
    if (!state || state.status !== "running" || state.daemonSessionId === null)
      return;
    if (args.outputAcks) this.ackVisibility.set(args.socket, true);
    this.clients.claimTerminalResizeOwnership(args.terminalId, args.socket);
    const requestId = randomUUID();
    const pending: PendingAttach = {
      daemonSessionId: state.daemonSessionId,
      terminalId: args.terminalId,
      socket: args.socket,
      requestId,
      rpcKey: rpcKey(state.daemonSessionId, args.terminalId, requestId),
    };
    void this.pendingAttaches.claim(pending).promise.catch(() => undefined);
    if (
      !this.host.sendDaemonDataMessage(state.daemonSessionId, {
        type: "terminal.attach",
        requestId,
        terminalId: args.terminalId,
        sinceSeq: args.sinceSeq,
        tailBytes: BROWSER_TERMINAL_REPLAY_MAX_BYTES,
      })
    ) {
      this.pendingAttaches.cancel(pending.rpcKey);
      this.holdForReattach(
        args.terminalId,
        state.session,
        args.socket,
        args.sinceSeq,
      );
      this.host.onDaemonSendFailed(state.daemonSessionId);
    }
  }

  holdForReattach(
    terminalId: string,
    session: TerminalSession,
    socket: TerminalDataPlaneSocket,
    sinceSeq: number,
    outputAcks = false,
  ): void {
    if (outputAcks) this.ackVisibility.set(socket, true);
    this.clients.registerTerminalClient(terminalId, socket);
    this.addFlowClient(terminalId, socket, sinceSeq);
    this.nextSeqByTerminal.set(
      terminalId,
      Math.max(this.nextSeqByTerminal.get(terminalId) ?? 0, sinceSeq),
    );
    this.sendSocketMessage(socket, {
      type: "attached",
      session,
      replayStartSeq: sinceSeq,
      nextSeq: sinceSeq,
    });
  }

  detachBrowserClient(
    socket: TerminalDataPlaneSocket,
    terminalId: string,
  ): void {
    this.clients.unregisterTerminalClient(terminalId, socket);
    this.flow.removeClient(terminalId, socket);
    this.pendingAttaches.failAllMatching(
      (pending) =>
        pending.terminalId === terminalId && pending.socket === socket,
      TERMINAL_ATTACH_CANCELLED,
    );
  }

  handleBrowserMessage(args: {
    message: TerminalClientMessage;
    socket: TerminalDataPlaneSocket;
    terminalId: string;
  }): void {
    switch (args.message.type) {
      case "ping":
        this.clients.sendTerminalSocketMessage(args.socket, { type: "pong" });
        return;
      case "input":
        this.host.onBrowserInput({
          terminalId: args.terminalId,
          socket: args.socket,
          dataBase64: args.message.dataBase64,
        });
        return;
      case "resize":
        if (this.clients.isTerminalResizeOwner(args.terminalId, args.socket))
          this.host.onBrowserResize({
            terminalId: args.terminalId,
            socket: args.socket,
            cols: args.message.cols,
            rows: args.message.rows,
          });
        return;
      case "ack":
        this.flow.acknowledge(
          args.terminalId,
          args.socket,
          args.message.nextSeq,
        );
        return;
      case "visibility":
        if (this.ackVisibility.has(args.socket))
          this.ackVisibility.set(args.socket, args.message.visible);
        this.flow.setVisible(
          args.terminalId,
          args.socket,
          args.message.visible,
        );
        return;
    }
  }

  handleDaemonDataMessage(args: {
    daemonSessionId: string;
    message: TerminalDaemonDataMessage;
  }): void {
    const { daemonSessionId, message } = args;
    const key =
      "requestId" in message
        ? rpcKey(daemonSessionId, message.terminalId, message.requestId)
        : "";
    switch (message.type) {
      case "terminal.output": {
        this.flow.recordOutput(
          message.terminalId,
          daemonSessionId,
          message.chunk.seq,
        );
        const state = this.states.get(message.terminalId);
        if (
          state?.status !== "running" ||
          state.daemonSessionId !== daemonSessionId ||
          this.catchingUp.has(message.terminalId)
        )
          return;
        this.forwardOutput(message.terminalId, message.chunk);
        return;
      }
      case "terminal.replay":
        if (this.pendingAttaches.settle(key, message)) return;
        if (this.pendingCatchUps.settle(key, message)) return;
        this.host.onReplay({ daemonSessionId, message });
        return;
      case "terminal.error":
        if (
          this.pendingAttaches.fail(
            key,
            terminalDataPlaneError(message.code, message.message),
          )
        )
          return;
        if (
          this.pendingCatchUps.fail(
            key,
            terminalDataPlaneError(message.code, message.message),
          )
        )
          return;
        this.host.onAttachError({
          daemonSessionId,
          terminalId: message.terminalId,
          requestId: message.requestId,
          code: message.code,
          message: message.message,
        });
        return;
      case "terminal.exited": {
        const state = this.states.get(message.terminalId);
        if (state?.daemonSessionId === daemonSessionId) {
          this.broadcastExited(message.terminalId, {
            ...state.session,
            status: "exited",
            closeReason: message.closeReason,
            exitCode: message.exitCode,
          });
        }
        this.host.onTerminalExited({
          daemonSessionId,
          terminalId: message.terminalId,
          closeReason: message.closeReason,
          exitCode: message.exitCode,
        });
        return;
      }
    }
  }

  broadcastSessionUpdated(terminalId: string, session: TerminalSession): void {
    this.clients.sendTerminalClientMessage(terminalId, {
      type: "session-updated",
      session,
    });
  }

  broadcastExited(terminalId: string, session: TerminalSession | null): void {
    if (session)
      this.clients.sendTerminalClientMessage(terminalId, {
        type: "exited",
        session,
      });
  }

  requestCatchUp(args: TerminalCatchUpRequest): void {
    const sinceSeq = this.nextSeqByTerminal.get(args.terminalId) ?? 0;
    if (!args.force && !this.clients.hasTerminalClients(args.terminalId)) return;
    const requestId = randomUUID();
    const pending: PendingKey = {
      daemonSessionId: args.daemonSessionId,
      terminalId: args.terminalId,
      requestId,
      rpcKey: rpcKey(args.daemonSessionId, args.terminalId, requestId),
    };
    this.catchingUp.add(args.terminalId);
    void this.pendingCatchUps.claim(pending).promise.catch(() => undefined);
    if (
      !this.host.sendDaemonDataMessage(args.daemonSessionId, {
        type: "terminal.attach",
        requestId,
        terminalId: args.terminalId,
        sinceSeq,
        tailBytes: BROWSER_TERMINAL_REPLAY_MAX_BYTES,
      })
    ) {
      this.pendingCatchUps.fail(
        pending.rpcKey,
        terminalDataPlaneError("host_disconnected", "Host is not connected"),
      );
    }
  }

  failPendingForDaemonSession(
    daemonSessionId: string,
    _reason: "daemon-disconnect",
  ): void {
    this.pendingAttaches.failAllMatching(
      (pending) => pending.daemonSessionId === daemonSessionId,
      terminalDataPlaneError("host_disconnected", "Host is not connected"),
    );
    this.pendingCatchUps.failAllMatching(
      (pending) => pending.daemonSessionId === daemonSessionId,
      terminalDataPlaneError("host_disconnected", "Host is not connected"),
    );
  }

  failPendingForTerminal(
    terminalId: string,
    code: string,
    message: string,
  ): void {
    this.pendingAttaches.failAllMatching(
      (pending) => pending.terminalId === terminalId,
      terminalDataPlaneError(code, message),
    );
  }

  forgetTerminal(terminalId: string): void {
    this.nextSeqByTerminal.delete(terminalId);
    this.flow.forgetTerminal(terminalId);
  }


  sendSocketMessage(
    socket: TerminalDataPlaneSocket,
    message:
      | { type: "error"; code: string; message: string }
      | {
          type: "attached";
          session: TerminalSession;
          replayStartSeq: number;
          nextSeq: number;
        }
      | { type: "exited"; session: TerminalSession },
  ): void {
    this.clients.sendTerminalSocketMessage(socket, message);
  }

  private sendError(
    socket: TerminalDataPlaneSocket,
    code: string,
    message: string,
  ): void {
    this.sendSocketMessage(socket, { type: "error", code, message });
  }

  private forwardOutput(
    terminalId: string,
    chunk: Extract<
      TerminalDaemonDataMessage,
      { type: "terminal.output" }
    >["chunk"],
  ): void {
    const nextSeq = this.nextSeqByTerminal.get(terminalId) ?? 0;
    if (chunk.seq < nextSeq) return;
    this.nextSeqByTerminal.set(terminalId, chunk.seq + 1);
    this.clients.sendTerminalClientMessage(terminalId, {
      type: "output",
      chunk: { seq: chunk.seq, dataBase64: chunk.dataBase64 },
    });
  }

  private completeAttach(pending: PendingAttach, replay: Replay): void {
    const state = this.states.get(pending.terminalId);
    if (!state) {
      this.clients.unregisterTerminalClient(pending.terminalId, pending.socket);
      this.sendError(
        pending.socket,
        "terminal_not_found",
        "Terminal session not found",
      );
      return;
    }
    this.clients.registerTerminalClient(pending.terminalId, pending.socket);
    this.addFlowClient(pending.terminalId, pending.socket, replay.nextSeq);
    this.nextSeqByTerminal.set(
      pending.terminalId,
      Math.max(
        this.nextSeqByTerminal.get(pending.terminalId) ?? 0,
        replay.nextSeq,
      ),
    );
    this.sendSocketMessage(pending.socket, {
      type: "attached",
      session: state.session,
      replayStartSeq: replay.replayStartSeq,
      nextSeq: replay.nextSeq,
    });
    for (const chunk of replay.chunks)
      this.clients.sendTerminalSocketMessage(pending.socket, {
        type: "output",
        chunk: { seq: chunk.seq, dataBase64: chunk.dataBase64 },
      });
  }

  private addFlowClient(
    terminalId: string,
    socket: TerminalDataPlaneSocket,
    nextSeq: number,
  ): void {
    const visible = this.ackVisibility.get(socket);
    if (visible !== undefined)
      this.flow.addClient(terminalId, socket, nextSeq, visible);
  }
}
