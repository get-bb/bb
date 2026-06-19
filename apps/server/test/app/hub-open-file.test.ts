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

  it("returns 0 and sends nothing when no clients are connected", () => {
    const hub = new NotificationHub();

    const delivered = hub.notifyThreadOpenFile("thr_1", {
      source: "thread-storage",
      path: "notes.md",
      lineNumber: null,
    });

    expect(delivered).toBe(0);
  });

  it("does not deliver to terminal-only sockets", () => {
    const hub = new NotificationHub();
    const terminalOnly = createMockHubSocket();
    hub.registerTerminalClient("term_1", terminalOnly);

    const delivered = hub.notifyThreadOpenFile("thr_1", {
      source: "workspace",
      path: "a.ts",
      lineNumber: null,
    });

    expect(delivered).toBe(0);
    expect(terminalOnly.messages).toHaveLength(0);
  });
});
