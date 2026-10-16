import { randomUUID } from "node:crypto";
import { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { hostDaemonTerminalDataDaemonMessageSchema } from "@bb/host-daemon-contract/terminal-data";
import {
  terminalClientMessageSchema,
  terminalServerMessageSchema,
} from "@bb/server-contract";
import {
  InProcessTerminalDataPlane,
  type TerminalDataPlaneSocket,
  type TerminalDataPlaneTerminalState,
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
  getBrowserBufferedAmount?: (socket: WebSocket) => number;
  logger: TerminalRelayLogger;
  send(message: TerminalRelayToMainMessage): void;
};
export interface TerminalRelayRuntime {
  acceptSocket(message: AcceptMessage, socket: Socket): void;
  handleMainMessage(message: MainToTerminalRelayMessage): void;
  dispose(): void;
}

const DAEMON_INPUT_QUEUE_MAX_BYTES = 64 * 1024;
const DAEMON_INPUT_QUEUE_TTL_MS = 10_000;

type PendingDaemonInput = {
  bytes: number;
  dataBase64: string;
  socket: TerminalDataPlaneSocket;
  terminalId: string;
};

type DaemonInputQueue = {
  bytes: number;
  expiresAt: number;
  items: PendingDaemonInput[];
  timeout: NodeJS.Timeout | null;
};

export function createTerminalRelayRuntime(
  options: TerminalRelayRuntimeOptions,
): TerminalRelayRuntime {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const browserSockets = new Map<
    string,
    {
      socket: WebSocket;
      planeSocket: TerminalDataPlaneSocket;
      terminalId: string;
      sinceSeq: number;
      outputAcks: boolean;
      authorized: boolean;
    }
  >();
  const daemonSockets = new Map<string, WebSocket>();
  const pendingInputsByDaemonSession = new Map<string, DaemonInputQueue>();
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

  function clearInputQueue(sessionId: string): void {
    const queue = pendingInputsByDaemonSession.get(sessionId);
    if (!queue) return;
    clearTimeout(queue.timeout ?? undefined);
    pendingInputsByDaemonSession.delete(sessionId);
  }

  function sendInputReconnecting(socket: TerminalDataPlaneSocket): void {
    plane.sendSocketMessage(socket, {
      type: "error",
      code: "terminal_data_channel_reconnecting",
      message: "Terminal data channel is reconnecting; retry input",
    });
  }

  function expireInputQueue(sessionId: string): void {
    const queue = pendingInputsByDaemonSession.get(sessionId);
    if (!queue) return;
    clearInputQueue(sessionId);
    for (const socket of new Set(queue.items.map((item) => item.socket)))
      sendInputReconnecting(socket);
  }

  function flushInputQueue(sessionId: string): void {
    const queue = pendingInputsByDaemonSession.get(sessionId);
    if (!queue) return;
    while (queue.items.length > 0) {
      const item = queue.items[0];
      if (!item) break;
      if (
        !sendDaemonDataMessage(sessionId, {
          type: "terminal.input",
          terminalId: item.terminalId,
          dataBase64: item.dataBase64,
        })
      )
        break;
      queue.items.shift();
      queue.bytes -= item.bytes;
      const socketId = socketIds.get(item.socket);
      if (socketId)
        options.send({
          type: "browser-input",
          terminalId: item.terminalId,
          socketId,
          dataBase64: item.dataBase64,
        });
    }
    if (queue.items.length === 0) clearInputQueue(sessionId);
  }

  function enqueueInput(args: {
    dataBase64: string;
    sessionId: string;
    socket: TerminalDataPlaneSocket;
    terminalId: string;
  }): boolean {
    const bytes = Buffer.byteLength(args.dataBase64, "utf8");
    const queue = pendingInputsByDaemonSession.get(args.sessionId) ?? {
      bytes: 0,
      expiresAt: Date.now() + DAEMON_INPUT_QUEUE_TTL_MS,
      items: [],
      timeout: null,
    };
    if (queue.bytes + bytes > DAEMON_INPUT_QUEUE_MAX_BYTES) return false;
    queue.items.push({
      bytes,
      dataBase64: args.dataBase64,
      socket: args.socket,
      terminalId: args.terminalId,
    });
    queue.bytes += bytes;
    pendingInputsByDaemonSession.set(args.sessionId, queue);
    if (queue.timeout === null) {
      queue.timeout = setTimeout(
        () => expireInputQueue(args.sessionId),
        Math.max(0, queue.expiresAt - Date.now()),
      );
      queue.timeout.unref();
    }
    return true;
  }
  const host: TerminalDataPlaneHost = {
    sendDaemonDataMessage,
    onBrowserInput: ({ socket, terminalId, dataBase64 }) => {
      const state = states.get(terminalId);
      if (!state || state.status !== "running" || !state.daemonSessionId) {
        plane.sendSocketMessage(socket, {
          type: "error",
          code: "host_disconnected",
          message: "Host is not connected",
        });
        return;
      }
      const sent = sendDaemonDataMessage(state.daemonSessionId, {
        type: "terminal.input",
        terminalId,
        dataBase64,
      });
      if (!sent) {
        if (
          !enqueueInput({
            dataBase64,
            sessionId: state.daemonSessionId,
            socket,
            terminalId,
          })
        )
          sendInputReconnecting(socket);
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
    onCatchUpError: (args) => options.send({ type: "catch-up-error", ...args }),
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
  const states = new Map<string, TerminalDataPlaneTerminalState | null>();
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
          const planeSocket: TerminalDataPlaneSocket = {
            get bufferedAmount() {
              return options.getBrowserBufferedAmount?.(ws) ?? ws.bufferedAmount;
            },
            close: (code, reason) => ws.close(code, reason),
            send: (data) => ws.send(data),
          };
          browserSockets.set(socketId, {
            socket: ws,
            terminalId,
            sinceSeq,
            authorized: false,
            outputAcks,
            planeSocket,
          });
          socketIds.set(planeSocket, socketId);
          ws.on("message", (raw) => {
            if (!browserSockets.get(socketId)?.authorized) return;
            const parsed = parseSocketMessage(
              planeSocket,
              raw,
              terminalClientMessageSchema,
            );
            if (parsed !== null)
              plane.handleBrowserMessage({
                message: parsed,
                socket: planeSocket,
                terminalId,
              });
          });
          ws.on("close", () => {
            browserSockets.delete(socketId);
            plane.detachBrowserClient(planeSocket, terminalId);
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
          flushInputQueue(sessionId);
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
            if (parsed !== null) {
              plane.handleDaemonDataMessage({
                daemonSessionId: sessionId,
                message: parsed,
              });
              if (parsed.type === "terminal.exited") clearInputQueue(sessionId);
            }
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
        const { socket, planeSocket, terminalId, sinceSeq, outputAcks } = client;
        if (message.decision === "running") {
          client.authorized = true;
          plane.attachBrowserClient({
            socket: planeSocket,
            terminalId,
            sinceSeq,
            outputAcks,
          });
        } else if (message.decision === "hold" && message.session) {
          client.authorized = true;
          plane.holdForReattach(
            terminalId,
            message.session,
            planeSocket,
            sinceSeq,
            outputAcks,
          );
        } else if (message.decision === "exited" && message.session) {
          plane.sendSocketMessage(planeSocket, {
            type: "attached",
            session: message.session,
            replayStartSeq: 0,
            nextSeq: 0,
          });
          plane.sendSocketMessage(planeSocket, {
            type: "exited",
            session: message.session,
          });
        } else {
          const missing = message.decision === "not-found";
          const code = missing ? "terminal_not_found" : "terminal_not_running";
          plane.sendSocketMessage(planeSocket, {
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
      case "fail-daemon-session": {
        plane.failPendingForDaemonSession(
          message.daemonSessionId,
          message.reason,
        );
        daemonSockets.get(message.daemonSessionId)?.close(1012, "daemon-disconnect");
        clearInputQueue(message.daemonSessionId);
        return;
      }
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
        const parsed = terminalServerMessageSchema.safeParse(message.message);
        if (!parsed.success) {
          options.logger.warn(
            { error: parsed.error, socketId: message.socketId },
            "Invalid terminal server message from main",
          );
          return;
        }
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify(parsed.data));
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
          plane.attachBrowserClient({ ...message, socket: client.planeSocket });
          client.socket.resume();
        }
        return;
      }
      case "detach-client": {
        const client = browserSockets.get(message.socketId);
        if (client) plane.detachBrowserClient(client.planeSocket, message.terminalId);
        return;
      }
      case "hold-for-reattach": {
        const client = browserSockets.get(message.socketId);
        if (client) {
          client.authorized = true;
          plane.holdForReattach(
            message.terminalId,
            message.session,
            client.planeSocket,
            message.sinceSeq,
            message.outputAcks,
          );
          client.socket.resume();
        }
        return;
      }
      case "browser-message": {
        const client = browserSockets.get(message.socketId);
        if (client)
          plane.handleBrowserMessage({
            terminalId: message.terminalId,
            socket: client.planeSocket,
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
    for (const sessionId of pendingInputsByDaemonSession.keys())
      clearInputQueue(sessionId);
    wss.close();
  }
  return { acceptSocket, handleMainMessage, dispose };
}
