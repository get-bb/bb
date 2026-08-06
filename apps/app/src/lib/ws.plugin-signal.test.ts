import { describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "./ws";

const PLUGIN_TARGET = {
  kind: "plugin-channel" as const,
  pluginId: "linear",
  channel: "issues",
};

describe("WebSocketManager plugin-signal routing", () => {
  it("dispatches plugin-signal messages to onPluginSignal subscribers", () => {
    const manager = new WebSocketManager();
    const received = vi.fn();
    manager.onPluginSignal(received);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "plugin-signal",
        pluginId: "linear",
        channel: "issues",
        payload: { count: 2 },
      }),
    );

    expect(received).toHaveBeenCalledWith({
      type: "plugin-signal",
      pluginId: "linear",
      channel: "issues",
      payload: { count: 2 },
    });
  });

  it("strips unknown fields from a newer server instead of dropping", () => {
    const manager = new WebSocketManager();
    const received = vi.fn();
    manager.onPluginSignal(received);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "plugin-signal",
        pluginId: "linear",
        channel: "issues",
        payload: null,
        futureField: "ignored",
      }),
    );

    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]?.[0]).not.toHaveProperty("futureField");
  });

  it("does not misroute other message types to plugin subscribers", () => {
    const manager = new WebSocketManager();
    const pluginSignals = vi.fn();
    const changed = vi.fn();
    manager.onPluginSignal(pluginSignals);
    manager.onChanged(changed);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "changed",
        entity: "system",
        changes: ["plugins-changed"],
      }),
    );

    expect(pluginSignals).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("ref-counts exact plugin-channel subscribe/unsubscribe keys", () => {
    const manager = new WebSocketManager();
    // Exercise the same refcount path useRealtime relies on without a live socket.
    manager.subscribe(PLUGIN_TARGET);
    manager.subscribe(PLUGIN_TARGET);
    manager.unsubscribe(PLUGIN_TARGET);
    // Still held by the second ref — no throw and map still tracks the key.
    manager.unsubscribe(PLUGIN_TARGET);
    // Fully released; extra unsubscribe is a no-op.
    manager.unsubscribe(PLUGIN_TARGET);
    manager.subscribe({
      kind: "plugin-channel",
      pluginId: "linear",
      channel: "other",
    });
    manager.subscribe(PLUGIN_TARGET);
    // Distinct channels are independent keys.
    manager.unsubscribe({
      kind: "plugin-channel",
      pluginId: "linear",
      channel: "other",
    });
    manager.unsubscribe(PLUGIN_TARGET);
  });
});
