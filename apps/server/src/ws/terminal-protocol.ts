import {
  terminalClientMessageSchema,
  terminalServerMessageSchema,
} from "@bb/server-contract";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import type { TerminalDataPlaneSocket } from "../services/terminals/terminal-data-plane.js";
import { parseSocketMessage } from "./decode-payload.js";

type TerminalProtocolDeps = Pick<AppDeps, "terminalSessions">;

interface TerminalSocket {
  readonly raw?: { readonly bufferedAmount?: number };
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

const terminalDataPlaneSockets = new WeakMap<
  TerminalSocket,
  TerminalDataPlaneSocket
>();

function toDataPlaneSocket(socket: TerminalSocket): TerminalDataPlaneSocket {
  const existing = terminalDataPlaneSockets.get(socket);
  if (existing) return existing;
  const wrapped: TerminalDataPlaneSocket = {
    get bufferedAmount() {
      return socket.raw?.bufferedAmount ?? 0;
    },
    close: (code, reason) => socket.close(code, reason),
    send: (data) => socket.send(data),
  };
  terminalDataPlaneSockets.set(socket, wrapped);
  return wrapped;
}

interface TerminalSocketOpenArgs {
  outputAcks: boolean;
  socket: TerminalSocket;
  sinceSeq: number;
  terminalId: string;
}

interface TerminalSocketMessageArgs {
  raw: unknown;
  socket: TerminalSocket;
  terminalId: string;
}

interface TerminalSocketCloseArgs {
  socket: TerminalSocket;
  terminalId: string;
}

interface TerminalSocketErrorArgs {
  code: string;
  message: string;
  socket: TerminalSocket;
}

function sendTerminalSocketError(args: TerminalSocketErrorArgs): void {
  const payload = terminalServerMessageSchema.parse({
    type: "error",
    code: args.code,
    message: args.message,
  });
  args.socket.send(JSON.stringify(payload));
}

function closeTerminalSocketWithError(args: TerminalSocketErrorArgs): void {
  sendTerminalSocketError(args);
  args.socket.close(1008, args.code);
}

function closeTerminalSocketForError(
  socket: TerminalSocket,
  error: unknown,
): void {
  if (error instanceof ApiError) {
    closeTerminalSocketWithError({
      socket,
      code: error.body.code,
      message: error.body.message,
    });
    return;
  }
  closeTerminalSocketWithError({
    socket,
    code: "terminal_socket_error",
    message: error instanceof Error ? error.message : String(error),
  });
}

export function onTerminalSocketOpen(
  deps: TerminalProtocolDeps,
  args: TerminalSocketOpenArgs,
): void {
  const socket = toDataPlaneSocket(args.socket);
  try {
    deps.terminalSessions.attachBrowserTerminal({
      outputAcks: args.outputAcks,
      socket,
      sinceSeq: args.sinceSeq,
      terminalId: args.terminalId,
    });
  } catch (error) {
    closeTerminalSocketForError(args.socket, error);
  }
}

export function onTerminalSocketMessage(
  deps: TerminalProtocolDeps,
  args: TerminalSocketMessageArgs,
): void {
  const message = parseSocketMessage(
    args.socket,
    args.raw,
    terminalClientMessageSchema,
  );
  if (message === null) {
    return;
  }

  const socket = toDataPlaneSocket(args.socket);
  try {
    deps.terminalSessions.handleBrowserTerminalMessage({
      message,
      socket,
      terminalId: args.terminalId,
    });
  } catch (error) {
    closeTerminalSocketForError(args.socket, error);
  }
}

export function onTerminalSocketClose(
  deps: TerminalProtocolDeps,
  args: TerminalSocketCloseArgs,
): void {
  deps.terminalSessions.detachBrowserTerminal({
    socket: toDataPlaneSocket(args.socket),
    terminalId: args.terminalId,
  });
}
