import { Buffer } from "node:buffer";
import {
  BROWSER_CONTROL_MAX_RESULT_BYTES,
  clientMessageSchema,
  type PongMessage,
} from "@bb/domain";
import { decodeSocketPayload } from "./decode-payload.js";
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
  let decoded: unknown;
  try {
    const payload = decodeSocketPayload(raw);
    if (Buffer.byteLength(payload, "utf8") > BROWSER_CONTROL_MAX_RESULT_BYTES) {
      socket.close(1009, "message-too-large");
      return;
    }
    decoded = JSON.parse(payload);
  } catch {
    socket.close(1008, "invalid-message");
    return;
  }

  const result = clientMessageSchema.safeParse(decoded);
  if (!result.success) {
    socket.close(1008, "invalid-message");
    return;
  }
  const parsed = result.data;

  switch (parsed.type) {
    case "subscribe":
      deps.hub.subscribe(socket, parsed.target);
      deps.watchInterests.subscribe(socket, parsed.target);
      break;
    case "unsubscribe":
      deps.hub.unsubscribe(socket, parsed.target);
      deps.watchInterests.unsubscribe(socket, parsed.target);
      break;
    case "ping":
      socket.send(JSON.stringify(PONG_MESSAGE));
      break;
    case "browser-client-state":
      deps.hub.updateBrowserClient(socket, parsed);
      break;
    case "browser-control-response":
      deps.hub.recordBrowserControlResponse(socket, parsed);
      break;
    case "browser-open-tab-response":
      deps.hub.recordBrowserOpenTabResponse(socket, parsed);
      break;
    case "browser-capture-chunk":
      deps.hub.recordBrowserCaptureChunk(socket, parsed);
      break;
    case "browser-capture-created":
      deps.hub.recordBrowserCaptureCreated(socket, parsed);
      break;
    case "browser-capture-register":
      deps.hub.recordBrowserCaptureRegister(socket, parsed);
      break;
    case "browser-capture-release":
      deps.hub.releaseBrowserCaptureFromClient(socket, {
        tabId: parsed.tabId,
        captureId: parsed.captureId,
      });
      break;
    case "browser-plugin-response":
      deps.hub.recordBrowserPluginResponse(socket, parsed);
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
