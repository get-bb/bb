import { randomUUID } from "node:crypto";
import { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { hostDaemonTerminalDataDaemonMessageSchema } from "@bb/host-daemon-contract";
import {
  terminalClientMessageSchema,
  terminalServerMessageSchema,
} from "@bb/server-contract";
import {
  InProcessTerminalDataPlane,
  type TerminalDataPlaneSocket,
} from "../services/terminals/terminal-data-plane.js";
import type { TerminalDataPlaneHost } from "../services/terminals/terminal-data-plane-host.js";
import { parseSocketMessage } from "../ws/decode-payload.js";
import type {
  AcceptMessage,
  MainToTerminalRelayMessage,
  TerminalRelayToMainMessage,
} from "./terminal-relay-ipc.js";

export type TerminalRelayLogger = {
  warn(details: Record<string, unknown>, message: string): void;
};
export type TerminalRelayRuntimeOptions = {
  logger: TerminalRelayLogger;
  send(message: TerminalRelayToMainMessage): void;
};
export interface TerminalRelayRuntime {
  acceptSocket(message: AcceptMessage, socket: Socket): void;
  handleMainMessage(message: MainToTerminalRelayMessage): void;
  dispose(): void;
}

export function createTerminalRelayRuntime(
  options: TerminalRelayRuntimeOptions,
): TerminalRelayRuntime {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const browserSockets = new Map<
    string,
    {
      socket: WebSocket;
      terminalId: string;
      sinceSeq: number;
      outputAcks: boolean;
      authorized: boolean;
    }
  >();
  const daemonSockets = new Map<string, WebSocket>();
  let fenced = false;
  const sendDaemonDataMessage: TerminalDataPlaneHost["sendDaemonDataMessage"] =
    (sessionId, message) => {
      const socket = daemonSockets.get(sessionId);
      if (!socket || socket.readyState !== WebSocket.OPEN || fenced)
        return false;
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        options.logger.warn(
          { err: error, sessionId },
          "Terminal relay daemon send failed",
        );
        return false;
      }
    };
  const host: TerminalDataPlaneHost = {
    sendDaemonDataMessage,
    onBrowserInput: ({ socket, terminalId, dataBase64 }) => {
      const state = states.get(terminalId);
      if (
        !state ||
        state.status !== "running" ||
        !state.daemonSessionId ||
        !sendDaemonDataMessage(state.daemonSessionId, {
          type: "terminal.input",
          terminalId,
          dataBase64,
        })
      ) {
        plane.sendSocketMessage(socket, {
          type: "error",
          code: "host_disconnected",
          message: "Host is not connected",
        });
        if (state?.daemonSessionId)
          options.send({
            type: "daemon-send-failed",
            sessionId: state.daemonSessionId,
          });
        return;
      }
      const socketId = socketIds.get(socket);
      if (socketId)
        options.send({
          type: "browser-input",
          terminalId,
          socketId,
          dataBase64,
        });
    },
    onBrowserResize: ({ socket, terminalId, cols, rows }) => {
      const state = states.get(terminalId);
      if (
        !state ||
        state.status !== "running" ||
        !state.daemonSessionId ||
        !sendDaemonDataMessage(state.daemonSessionId, {
          type: "terminal.resize",
          terminalId,
          cols,
          rows,
        })
      ) {
        plane.sendSocketMessage(socket, {
          type: "error",
          code: "host_disconnected",
          message: "Host is not connected",
        });
        if (state?.daemonSessionId)
          options.send({
            type: "daemon-send-failed",
            sessionId: state.daemonSessionId,
          });
        return;
      }
      const socketId = socketIds.get(socket);
      if (socketId)
        options.send({
          type: "browser-resize",
          terminalId,
          socketId,
          cols,
          rows,
        });
    },
    onTerminalExited: (args) =>
      options.send({ type: "terminal-exited", ...args }),
    onAttachError: (args) => options.send({ type: "attach-error", ...args }),
    onReplay: ({ daemonSessionId, message }) =>
      options.send({
        type: "replay",
        daemonSessionId,
        requestId: message.requestId,
        terminalId: message.terminalId,
        chunks: message.chunks,
        replayStartSeq: message.replayStartSeq,
        nextSeq: message.nextSeq,
      }),
    onDaemonSendFailed: (sessionId) =>
      options.send({ type: "daemon-send-failed", sessionId }),
  };
  const states = new Map<
    string,
    Parameters<InProcessTerminalDataPlane["setTerminalState"]>[1]
  >();
  const socketIds = new WeakMap<TerminalDataPlaneSocket, string>();
  const plane = new InProcessTerminalDataPlane(host);
  const metrics = setInterval(
    () =>
      options.send({
        type: "metrics",
        rssBytes: process.memoryUsage().rss,
        clients: browserSockets.size,
        daemonSockets: daemonSockets.size,
      }),
    10_000,
  );
  metrics.unref();

  function acceptSocket(message: AcceptMessage, socket: Socket): void {
    socket.setNoDelay(true);
    const request = new IncomingMessage(socket);
    request.headers = message.headers;
    request.method = message.method;
    request.url = message.url;
    wss.handleUpgrade(
      request,
      socket,
      Buffer.from(message.head, "base64"),
      (ws) => {
        if (message.type === "accept-browser") {
          const socketId = randomUUID();
          const { terminalId, sinceSeq, outputAcks } = message.grant;
          browserSockets.set(socketId, {
            socket: ws,
            terminalId,
            sinceSeq,
            authorized: false,
            outputAcks,
          });
          socketIds.set(ws, socketId);
          ws.on("message", (raw) => {
            if (!browserSockets.get(socketId)?.authorized) return;
            const parsed = parseSocketMessage(
              ws,
              raw,
              terminalClientMessageSchema,
            );
            if (parsed !== null)
              plane.handleBrowserMessage({
                message: parsed,
                socket: ws,
                terminalId,
              });
          });
          ws.on("close", () => {
            browserSockets.delete(socketId);
            plane.detachBrowserClient(ws, terminalId);
          });
          ws.pause();
          options.send({ type: "attach-requested", terminalId, socketId });
        } else {
          const { sessionId, hostId } = message.grant;
          if (fenced) {
            ws.close(1012, "server-moving");
            return;
          }
          daemonSockets.get(sessionId)?.close(1012, "replaced");
          daemonSockets.set(sessionId, ws);
          options.send({
            type: "daemon-data-socket-opened",
            sessionId,
            hostId,
          });
          ws.on("message", (raw) => {
            if (fenced) {
              ws.close(1012, "server-moving");
              return;
            }
            const parsed = parseSocketMessage(
              ws,
              raw,
              hostDaemonTerminalDataDaemonMessageSchema,
            );
            if (parsed !== null)
              plane.handleDaemonDataMessage({
                daemonSessionId: sessionId,
                message: parsed,
              });
          });
          ws.on("close", () => {
            if (daemonSockets.get(sessionId) !== ws) return;
            daemonSockets.delete(sessionId);
            options.send({ type: "daemon-data-socket-closed", sessionId });
          });
          socket.resume();
        }
      },
    );
  }

  function handleMainMessage(message: MainToTerminalRelayMessage): void {
    switch (message.type) {
      case "accept-browser":
      case "accept-daemon-data":
        return;
      case "attach-decision": {
        const client = browserSockets.get(message.socketId);
        if (!client || client.socket.readyState !== WebSocket.OPEN) return;
        const { socket, terminalId, sinceSeq, outputAcks } = client;
        if (message.decision === "running") {
          client.authorized = true;
          plane.attachBrowserClient({
            socket,
            terminalId,
            sinceSeq,
            outputAcks,
          });
        } else if (message.decision === "hold" && message.session) {
          client.authorized = true;
          plane.holdForReattach(
            terminalId,
            message.session,
            socket,
            sinceSeq,
            outputAcks,
          );
        } else if (message.decision === "exited" && message.session) {
          plane.sendSocketMessage(socket, {
            type: "attached",
            session: message.session,
            replayStartSeq: 0,
            nextSeq: 0,
          });
          plane.sendSocketMessage(socket, {
            type: "exited",
            session: message.session,
          });
        } else {
          const missing = message.decision === "not-found";
          const code = missing ? "terminal_not_found" : "terminal_not_running";
          plane.sendSocketMessage(socket, {
            type: "error",
            code,
            message: missing
              ? "Terminal session not found"
              : "Terminal session is not running",
          });
          socket.close(1008, code);
        }
        socket.resume();
        return;
      }
      case "terminal-state":
        if (message.state === null) states.delete(message.terminalId);
        else states.set(message.terminalId, message.state);
        plane.setTerminalState(message.terminalId, message.state);
        return;
      case "session-updated":
        plane.broadcastSessionUpdated(message.terminalId, message.session);
        return;
      case "exited":
        plane.broadcastExited(message.terminalId, message.session);
        return;
      case "request-catch-up":
        plane.requestCatchUp(message);
        return;
      case "fail-daemon-session":
        plane.failPendingForDaemonSession(
          message.daemonSessionId,
          message.reason,
        );
        return;
      case "fail-terminal":
        plane.failPendingForTerminal(
          message.terminalId,
          message.code,
          message.message,
        );
        return;
      case "forget-terminal":
        plane.forgetTerminal(message.terminalId);
        return;
      case "send-socket-message": {
        const socket = browserSockets.get(message.socketId)?.socket;
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify(terminalServerMessageSchema.parse(message.message)),
          );
        return;
      }
      case "close-socket": {
        const socket = browserSockets.get(message.socketId)?.socket;
        socket?.close(message.code, message.reason);
        socket?.resume();
        return;
      }
      case "attach-client": {
        const client = browserSockets.get(message.socketId);
        if (client) {
          client.authorized = true;
          plane.attachBrowserClient({ ...message, socket: client.socket });
          client.socket.resume();
        }
        return;
      }
      case "detach-client": {
        const socket = browserSockets.get(message.socketId)?.socket;
        if (socket) plane.detachBrowserClient(socket, message.terminalId);
        return;
      }
      case "hold-for-reattach": {
        const client = browserSockets.get(message.socketId);
        if (client) {
          client.authorized = true;
          plane.holdForReattach(
            message.terminalId,
            message.session,
            client.socket,
            message.sinceSeq,
            message.outputAcks,
          );
          client.socket.resume();
        }
        return;
      }
      case "browser-message": {
        const socket = browserSockets.get(message.socketId)?.socket;
        if (socket)
          plane.handleBrowserMessage({
            terminalId: message.terminalId,
            socket,
            message: message.message,
          });
        return;
      }
      case "daemon-message":
        plane.handleDaemonDataMessage(message);
        return;
      case "send-daemon-data":
        sendDaemonDataMessage(message.daemonSessionId, message.message);
        return;
      case "move-fence":
        fenced = message.pending;
        if (fenced)
          for (const socket of daemonSockets.values())
            socket.close(1012, "server-moving");
        return;
      case "shutdown":
        dispose();
        return;
    }
  }

  function dispose(): void {
    clearInterval(metrics);
    for (const { socket } of browserSockets.values())
      socket.close(1012, "server-restart");
    for (const socket of daemonSockets.values())
      socket.close(1012, "server-restart");
    wss.close();
  }
  return { acceptSocket, handleMainMessage, dispose };
}
