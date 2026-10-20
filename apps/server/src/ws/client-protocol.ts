import { clientMessageSchema, type PongMessage } from "@bb/domain";
import { parseSocketMessage } from "./decode-payload.js";
import type { NotificationHub } from "./hub.js";
import type { WatchInterestCoordinator } from "./watch-interests.js";

const PONG_MESSAGE: PongMessage = { type: "pong" };

interface ClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function onClientSocketOpen(
  hub: NotificationHub,
  socket: ClientSocket,
): void {
  hub.registerClient(socket);
}

export function onClientSocketMessage(
  deps: {
    hub: NotificationHub;
    watchInterests: Pick<
      WatchInterestCoordinator,
      "subscribe" | "unsubscribe" | "releaseSocket"
    >;
  },
  socket: ClientSocket,
  raw: unknown,
): void {
  const parsed = parseSocketMessage(socket, raw, clientMessageSchema);
  if (parsed === null) {
    return;
  }

  switch (parsed.type) {
    case "subscribe":
      for (const target of parsed.targets ??
        (parsed.target ? [parsed.target] : [])) {
        deps.hub.subscribe(socket, target);
        deps.watchInterests.subscribe(socket, target);
      }
      break;
    case "unsubscribe":
      for (const target of parsed.targets ??
        (parsed.target ? [parsed.target] : [])) {
        deps.hub.unsubscribe(socket, target);
        deps.watchInterests.unsubscribe(socket, target);
      }
      break;
    case "ping":
      socket.send(JSON.stringify(PONG_MESSAGE));
      break;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unhandled client message: ${_exhaustive}`);
    }
  }
}

export function onClientSocketClose(
  deps: {
    hub: NotificationHub;
    watchInterests: Pick<WatchInterestCoordinator, "releaseSocket">;
  },
  socket: ClientSocket,
): void {
  deps.watchInterests.releaseSocket(socket);
  deps.hub.unregisterClient(socket);
}
