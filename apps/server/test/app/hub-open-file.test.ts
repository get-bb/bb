import { describe, expect, it } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("NotificationHub.notifyThreadOpen", () => {
  it("broadcasts to every connected client and returns the delivered count", () => {
    const hub = new NotificationHub();
    const viewing = createMockHubSocket();
    const other = createMockHubSocket();
    // Subscriptions differ, but the open-file signal broadcasts to every client
    // so a client not currently viewing the thread can open it on navigation.
    hub.subscribe(viewing, { kind: "thread-detail", threadId: "thr_1" });
    hub.subscribe(other, { kind: "thread-detail", threadId: "thr_2" });

    const delivered = hub.notifyThreadOpen(
      { projectId: "proj_1", threadId: "thr_1" },
      {
        split: "right",
        file: {
          source: "workspace",
          path: "src/index.ts",
          lineNumber: 42,
        },
      },
    );

    expect(delivered).toBe(2);
    for (const socket of [viewing, other]) {
      expect(socket.messages).toHaveLength(1);
      expect(JSON.parse(socket.messages[0])).toEqual({
        type: "thread-open",
        projectId: "proj_1",
        threadId: "thr_1",
        split: "right",
        file: {
          source: "workspace",
          path: "src/index.ts",
          lineNumber: 42,
        },
      });
    }
  });

  it("broadcasts typed thread-pane actions to every connected client", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    hub.registerClient(first);
    hub.registerClient(second);

    expect(
      hub.notifyThreadPaneAction(
        { projectId: "proj_1", threadId: "thr_1" },
        "clear-spotlight",
      ),
    ).toBe(2);
    for (const socket of [first, second]) {
      expect(JSON.parse(socket.messages[0]!)).toEqual({
        type: "thread-pane-action",
        projectId: "proj_1",
        threadId: "thr_1",
        action: "clear-spotlight",
      });
    }
  });

  it("delivers thread ephemera to scoped sockets only for exact thread-detail", () => {
    const hub = new NotificationHub();
    const subscribed = createMockHubSocket();
    const otherThread = createMockHubSocket();
    const unsubscribed = createMockHubSocket();
    hub.registerClient(subscribed, "scoped");
    hub.registerClient(otherThread, "scoped");
    hub.registerClient(unsubscribed, "scoped");
    hub.subscribe(subscribed, { kind: "thread-detail", threadId: "thr_1" });
    hub.subscribe(otherThread, { kind: "thread-detail", threadId: "thr_2" });

    expect(
      hub.notifyThreadOpen(
        { projectId: "proj_1", threadId: "thr_1" },
        { split: "right", file: null },
      ),
    ).toBe(1);
    expect(subscribed.messages).toHaveLength(1);
    expect(otherThread.messages).toHaveLength(0);
    expect(unsubscribed.messages).toHaveLength(0);

    expect(
      hub.notifyThreadPaneAction(
        { projectId: "proj_1", threadId: "thr_1" },
        "maximize",
      ),
    ).toBe(1);
    expect(subscribed.messages).toHaveLength(2);
    expect(otherThread.messages).toHaveLength(0);
  });

  it("does not overwrite a scoped delivery mode when subscribe re-registers", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerClient(socket, "scoped");
    // subscribe calls registerClient without a mode; must keep scoped.
    hub.subscribe(socket, { kind: "thread-detail", threadId: "thr_other" });

    expect(
      hub.notifyThreadOpen(
        { projectId: "proj_1", threadId: "thr_1" },
        { split: "left", file: null },
      ),
    ).toBe(0);
    expect(socket.messages).toHaveLength(0);
  });
});
