import { hostDaemonTerminalDataDaemonMessageSchema } from "@bb/host-daemon-contract";
import type { AppDeps } from "../types.js";
import { isServerMoveSnapshotFenced } from "../services/server-move/freeze-state.js";
import { parseSocketMessage } from "./decode-payload.js";

interface DaemonDataSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function onTerminalDataSocketOpen(
  deps: Pick<AppDeps, "db" | "hub" | "terminalSessions">,
  args: { sessionId: string; socket: DaemonDataSocket },
): void {
  if (isServerMoveSnapshotFenced(deps.db)) {
    args.socket.close(1012, "server-moving");
    return;
  }
  deps.hub.registerDaemonDataSocket(args.sessionId, args.socket);
  deps.terminalSessions.onDaemonDataSocketOpened(args.sessionId);
}

export function onTerminalDataSocketMessage(
  deps: Pick<AppDeps, "db" | "terminalSessions">,
  args: { raw: unknown; sessionId: string; socket: DaemonDataSocket },
): void {
  if (isServerMoveSnapshotFenced(deps.db)) {
    args.socket.close(1012, "server-moving");
    return;
  }
  const message = parseSocketMessage(
    args.socket,
    args.raw,
    hostDaemonTerminalDataDaemonMessageSchema,
  );
  if (message !== null) {
    deps.terminalSessions.handleDaemonDataMessage({
      sessionId: args.sessionId,
      message,
    });
  }
}

export function onTerminalDataSocketClose(
  deps: Pick<AppDeps, "hub" | "terminalSessions">,
  args: { sessionId: string; socket: DaemonDataSocket },
): void {
  if (deps.hub.unregisterDaemonDataSocket(args.sessionId, args.socket)) {
    deps.terminalSessions.onDaemonDataSocketClosed(args.sessionId);
  }
}
