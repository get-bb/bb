import { describe, expect, it } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("NotificationHub.notifyPluginSignal", () => {
  it("broadcasts to every unrestricted client regardless of subscriptions", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    // V1 unrestricted: the signal reaches every unrestricted client
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

  it("delivers scoped plugin signals only to the exact pluginId+channel key", () => {
    const hub = new NotificationHub();
    const unrestricted = createMockHubSocket();
    const scopedExact = createMockHubSocket();
    const scopedWrongChannel = createMockHubSocket();
    const scopedWrongPlugin = createMockHubSocket();
    const scopedUnsubscribed = createMockHubSocket();

    hub.registerClient(unrestricted, "unrestricted");
    hub.registerClient(scopedExact, "scoped");
    hub.registerClient(scopedWrongChannel, "scoped");
    hub.registerClient(scopedWrongPlugin, "scoped");
    hub.registerClient(scopedUnsubscribed, "scoped");

    hub.subscribe(scopedExact, {
      kind: "plugin-channel",
      pluginId: "A",
      channel: "x",
    });
    hub.subscribe(scopedWrongChannel, {
      kind: "plugin-channel",
      pluginId: "A",
      channel: "y",
    });
    hub.subscribe(scopedWrongPlugin, {
      kind: "plugin-channel",
      pluginId: "B",
      channel: "x",
    });
    hub.subscribe(scopedUnsubscribed, {
      kind: "thread-detail",
      threadId: "thr_1",
    });

    const delivered = hub.notifyPluginSignal("A", "x", { n: 1 });

    expect(delivered).toBe(2); // unrestricted + exact scoped
    expect(unrestricted.messages).toHaveLength(1);
    expect(scopedExact.messages).toHaveLength(1);
    expect(JSON.parse(scopedExact.messages[0]!)).toMatchObject({
      type: "plugin-signal",
      pluginId: "A",
      channel: "x",
    });
    expect(scopedWrongChannel.messages).toHaveLength(0);
    expect(scopedWrongPlugin.messages).toHaveLength(0);
    expect(scopedUnsubscribed.messages).toHaveLength(0);
  });

  it("withholds plugin signals from scoped sockets without a matching channel", () => {
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
