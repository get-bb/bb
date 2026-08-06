import { describe, expect, it } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("NotificationHub.notifyPluginSignal", () => {
  it("broadcasts to every connected client and returns the delivered count", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    // V1 has no per-channel subscriptions: the signal reaches every client
    // regardless of what they subscribed to.
    hub.subscribe(first, { kind: "thread-detail", threadId: "thr_1" });
    hub.subscribe(second, { kind: "system" });

    const delivered = hub.notifyPluginSignal("linear", "issues-updated", {
      count: 42,
    });

    expect(delivered).toBe(2);
    for (const socket of [first, second]) {
      expect(socket.messages).toHaveLength(1);
      expect(JSON.parse(socket.messages[0]!)).toEqual({
        type: "plugin-signal",
        pluginId: "linear",
        channel: "issues-updated",
        payload: { count: 42 },
      });
    }
  });

  it("withholds plugin signals from scoped sockets pending channel capabilities", () => {
    const hub = new NotificationHub();
    const unrestricted = createMockHubSocket();
    const scoped = createMockHubSocket();
    hub.registerClient(unrestricted, "unrestricted");
    hub.registerClient(scoped, "scoped");
    hub.subscribe(scoped, { kind: "thread-detail", threadId: "thr_1" });

    const delivered = hub.notifyPluginSignal("linear", "issues-updated", {
      count: 1,
    });

    expect(delivered).toBe(1);
    expect(unrestricted.messages).toHaveLength(1);
    expect(scoped.messages).toHaveLength(0);
  });
});
