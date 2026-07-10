import { describe, expect, it } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("NotificationHub.notifyThreadOpenFile", () => {
  it("broadcasts to every connected client and returns the delivered count", () => {
    const hub = new NotificationHub();
    const viewing = createMockHubSocket();
    const other = createMockHubSocket();
    // Subscriptions differ, but the open-file signal broadcasts to every client
    // so a client not currently viewing the thread can open it on navigation.
    hub.subscribe(viewing, { kind: "thread-detail", threadId: "thr_1" });
    hub.subscribe(other, { kind: "thread-detail", threadId: "thr_2" });

    const delivered = hub.notifyThreadOpenFile("thr_1", {
      source: "workspace",
      path: "src/index.ts",
      lineNumber: 42,
    });

    expect(delivered).toBe(2);
    for (const socket of [viewing, other]) {
      expect(socket.messages).toHaveLength(1);
      expect(JSON.parse(socket.messages[0])).toEqual({
        type: "thread-open-file",
        threadId: "thr_1",
        source: "workspace",
        path: "src/index.ts",
        lineNumber: 42,
      });
    }
  });
});
