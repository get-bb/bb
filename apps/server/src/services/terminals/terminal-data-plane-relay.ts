import type { HostDaemonTerminalDataServerMessage } from "@bb/host-daemon-contract/terminal-data";
import {
  terminalServerMessageSchema,
  type TerminalSession,
} from "@bb/server-contract";
import type {
  TerminalCatchUpRequest,
  TerminalDataPlane,
  TerminalDataPlaneSocket,
  TerminalDaemonDataMessage,
  TerminalDataPlaneTerminalState,
} from "./terminal-data-plane.js";
import type { TerminalRelaySupervisor } from "../../terminal-relay/terminal-relay-supervisor.js";

export class RelayTerminalDataPlane implements TerminalDataPlane {
  private readonly ids = new WeakMap<TerminalDataPlaneSocket, string>();
  private readonly daemonSessions = new Set<string>();

  constructor(private readonly relay: TerminalRelaySupervisor) {}

  socketForId(socketId: string): TerminalDataPlaneSocket {
    const socket: TerminalDataPlaneSocket = {
      get bufferedAmount() {
        return 0;
      },
      send: (data) => {
        const message: unknown = JSON.parse(data);
        this.relay.send({
          type: "send-socket-message",
          socketId,
          message: terminalServerMessageSchema.parse(message),
        });
      },
      close: (code = 1000, reason = "") => {
        this.relay.send({ type: "close-socket", socketId, code, reason });
      },
    };
    this.ids.set(socket, socketId);
    return socket;
  }

  private socketId(socket: TerminalDataPlaneSocket): string {
    const id = this.ids.get(socket);
    if (!id) throw new Error("Terminal socket does not belong to the relay");
    return id;
  }

  updateClients(_count: number): void {}
  daemonOpened(sessionId: string): void {
    this.daemonSessions.add(sessionId);
  }
  daemonClosed(sessionId: string): void {
    this.daemonSessions.delete(sessionId);
  }
  reset(): void {
    this.daemonSessions.clear();
  }
  sendDaemonDataMessage(
    daemonSessionId: string,
    message: HostDaemonTerminalDataServerMessage,
  ): boolean {
    return (
      this.daemonSessions.has(daemonSessionId) &&
      this.relay.send({ type: "send-daemon-data", daemonSessionId, message })
    );
  }
  attachBrowserClient(args: {
    socket: TerminalDataPlaneSocket;
    terminalId: string;
    sinceSeq: number;
    outputAcks: boolean;
  }): void {
    this.relay.send({
      type: "attach-client",
      socketId: this.socketId(args.socket),
      terminalId: args.terminalId,
      sinceSeq: args.sinceSeq,
      outputAcks: args.outputAcks,
    });
  }
  detachBrowserClient(
    socket: TerminalDataPlaneSocket,
    terminalId: string,
  ): void {
    this.relay.send({
      type: "detach-client",
      socketId: this.socketId(socket),
      terminalId,
    });
  }
  handleBrowserMessage(args: {
    socket: TerminalDataPlaneSocket;
    terminalId: string;
    message: Parameters<
      TerminalDataPlane["handleBrowserMessage"]
    >[0]["message"];
  }): void {
    this.relay.send({
      type: "browser-message",
      socketId: this.socketId(args.socket),
      terminalId: args.terminalId,
      message: args.message,
    });
  }
  handleDaemonDataMessage(args: {
    daemonSessionId: string;
    message: TerminalDaemonDataMessage;
  }): void {
    this.relay.send({ type: "daemon-message", ...args });
  }
  holdForReattach(
    terminalId: string,
    session: TerminalSession,
    socket: TerminalDataPlaneSocket,
    sinceSeq: number,
    outputAcks = false,
  ): void {
    this.relay.send({
      type: "hold-for-reattach",
      socketId: this.socketId(socket),
      terminalId,
      session,
      sinceSeq,
      outputAcks,
    });
  }
  setTerminalState(
    terminalId: string,
    state: TerminalDataPlaneTerminalState | null,
  ): void {
    this.relay.send({ type: "terminal-state", terminalId, state });
  }
  broadcastSessionUpdated(terminalId: string, session: TerminalSession): void {
    this.relay.send({ type: "session-updated", terminalId, session });
  }
  broadcastExited(terminalId: string, session: TerminalSession): void {
    this.relay.send({ type: "exited", terminalId, session });
  }
  requestCatchUp(args: TerminalCatchUpRequest): void {
    this.relay.send({ type: "request-catch-up", ...args });
  }
  failPendingForDaemonSession(
    daemonSessionId: string,
    reason: "daemon-disconnect",
  ): void {
    this.relay.send({ type: "fail-daemon-session", daemonSessionId, reason });
  }
  failPendingForTerminal(
    terminalId: string,
    code: string,
    message: string,
  ): void {
    this.relay.send({ type: "fail-terminal", terminalId, code, message });
  }
  forgetTerminal(terminalId: string): void {
    this.relay.send({ type: "forget-terminal", terminalId });
  }
  sendSocketMessage(
    socket: TerminalDataPlaneSocket,
    message: Parameters<TerminalDataPlane["sendSocketMessage"]>[1],
  ): void {
    this.relay.send({
      type: "send-socket-message",
      socketId: this.socketId(socket),
      message,
    });
  }
}
