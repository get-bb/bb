import { clientMessageSchema, type PongMessage } from "@bb/domain";
import type { BrowserAutomationService } from "../services/browser/browser-automation.js";
import { decodeSocketPayload } from "./decode-payload.js";
import type { NotificationHub } from "./hub.js";
import type { WatchInterestCoordinator } from "./watch-interests.js";

const PONG_MESSAGE: PongMessage = { type: "pong" };
const MAX_CLIENT_MESSAGE_CHARS = 12 * 1024 * 1024;

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
    browserAutomation: Pick<
      BrowserAutomationService,
      | "registerConnection"
      | "recordCancelRequest"
      | "recordCommandFailed"
      | "recordCommandResult"
      | "recordOpenReady"
      | "recordOpenFailed"
      | "recordTargetClosed"
      | "releaseConnection"
    >;
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
    if (payload.length > MAX_CLIENT_MESSAGE_CHARS) {
      socket.close(1008, "invalid-message");
      return;
    }
    decoded = JSON.parse(payload);
  } catch {
    socket.close(1008, "invalid-message");
    return;
  }

  let result: ReturnType<typeof clientMessageSchema.safeParse>;
  try {
    result = clientMessageSchema.safeParse(decoded);
  } catch {
    socket.close(1008, "invalid-message");
    return;
  }
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
    case "browser-automation.capability":
      deps.browserAutomation.registerConnection(socket, parsed);
      break;
    case "browser-automation.capability-unavailable":
      deps.browserAutomation.releaseConnection(socket);
      break;
    case "browser-automation.open-ready":
      deps.browserAutomation.recordOpenReady(socket, parsed);
      break;
    case "browser-automation.open-failed":
      deps.browserAutomation.recordOpenFailed(socket, parsed);
      break;
    case "browser-automation.target-closed":
      deps.browserAutomation.recordTargetClosed(socket, parsed);
      break;
    case "browser-automation.command-result":
      deps.browserAutomation.recordCommandResult(socket, parsed);
      break;
    case "browser-automation.command-failed":
      deps.browserAutomation.recordCommandFailed(socket, parsed);
      break;
    case "browser-automation.cancel-request":
      deps.browserAutomation.recordCancelRequest(socket, parsed);
      break;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unhandled client message: ${_exhaustive}`);
    }
  }
}

export function onClientSocketClose(
  deps: {
    browserAutomation: Pick<BrowserAutomationService, "releaseConnection">;
    hub: NotificationHub;
    watchInterests: Pick<WatchInterestCoordinator, "releaseSocket">;
  },
  socket: ClientSocket,
): void {
  deps.browserAutomation.releaseConnection(socket);
  deps.watchInterests.releaseSocket(socket);
  deps.hub.unregisterClient(socket);
}
