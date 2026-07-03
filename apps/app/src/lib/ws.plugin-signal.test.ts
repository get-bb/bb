import { describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "./ws";

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
});
