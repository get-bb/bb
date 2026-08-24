import type { JsonObject } from "@bb/domain";
import { onDaemonSocketMessage } from "../../src/ws/daemon-protocol.js";
import type { TestAppHarness } from "./test-app.js";

export interface TestDaemonWebSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface FeedRawDaemonWebSocketMessageArgs {
  harness: TestAppHarness;
  hostId: string;
  rawMessage: JsonObject;
  sessionId: string;
  socket: TestDaemonWebSocket;
}

export function feedRawDaemonWebSocketMessage(
  args: FeedRawDaemonWebSocketMessageArgs,
): void {
  onDaemonSocketMessage(args.harness.deps, {
    hostId: args.hostId,
    raw: JSON.stringify(args.rawMessage),
    sessionId: args.sessionId,
    socket: args.socket,
  });
}
