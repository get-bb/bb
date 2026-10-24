import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopNotificationDelivery,
  createNotificationClaims,
} from "../src/desktop-notifications.js";

class TestNotification extends EventEmitter {
  show = vi.fn();
  close = vi.fn();
}

const signal = {
  type: "plugin-signal",
  pluginId: "push-notifications",
  channel: "notification",
  payload: {
    id: "event-1",
    title: "Thread",
    body: "Ready",
    threadId: "thread-1",
    channels: ["desktop"],
    kind: "finished",
  },
};

function setup() {
  const notification = new TestNotification();
  const args = {
    serverUrl: "http://localhost:3000",
    hasOpenWindows: vi.fn(() => false),
    isSupported: vi.fn(() => true),
    claim: createNotificationClaims(),
    createNotification: vi.fn(() => notification),
    openThread: vi.fn(),
    recordSent: vi.fn(),
  };
  return {
    args,
    notification,
    delivery: createDesktopNotificationDelivery(args),
  };
}

describe("closed-window notifications", () => {
  it("leaves open windows in charge, and deduplicates a renderer delivery that precedes closing", () => {
    const { args, delivery } = setup();
    args.hasOpenWindows.mockReturnValue(true);
    delivery.receive(signal);
    expect(args.createNotification).not.toHaveBeenCalled();
    expect(args.claim(args.serverUrl, signal.payload.id)).toBe(true);
    args.hasOpenWindows.mockReturnValue(false);
    delivery.receive(signal);
    expect(args.createNotification).not.toHaveBeenCalled();
  });

  it("claims a closed-window delivery before a reopening renderer can show the same event", () => {
    const { args, delivery, notification } = setup();
    delivery.receive(signal);
    delivery.receive(signal);
    expect(notification.show).toHaveBeenCalledOnce();
    expect(args.claim(args.serverUrl, signal.payload.id)).toBe(false);
    expect(args.claim("http://localhost:4000", signal.payload.id)).toBe(true);
    notification.emit("click");
    expect(args.openThread).toHaveBeenCalledExactlyOnceWith("thread-1");
    expect(notification.close).toHaveBeenCalledOnce();
  });

  it.each(["needs_input", "failed", "finished"])(
    "records sending %s once",
    (kind) => {
      const { args, delivery } = setup();
      delivery.receive({ ...signal, payload: { ...signal.payload, kind } });
      delivery.receive({ ...signal, payload: { ...signal.payload, kind } });
      expect(args.recordSent).toHaveBeenCalledExactlyOnceWith(kind);
      delivery.stop();
    },
  );

  it("does not count notification tests as thread activity", () => {
    const test = setup();
    test.delivery.receive({
      ...signal,
      payload: { ...signal.payload, id: "test", kind: null, threadId: null },
    });
    test.notification.emit("show");
    expect(test.args.recordSent).not.toHaveBeenCalled();
    test.delivery.stop();
  });

  it("rejects disabled desktop channels, other plugins, malformed data and unsupported systems", () => {
    const { args, delivery } = setup();
    delivery.receive({
      ...signal,
      payload: { ...signal.payload, channels: ["web"] },
    });
    delivery.receive({ ...signal, pluginId: "other" });
    delivery.receive({
      ...signal,
      payload: { ...signal.payload, threadId: 42 },
    });
    args.isSupported.mockReturnValue(false);
    delivery.receive(signal);
    expect(args.createNotification).not.toHaveBeenCalled();
    args.isSupported.mockReturnValue(true);
    delivery.receive(signal);
    expect(args.createNotification).toHaveBeenCalledOnce();
    delivery.stop();
    delivery.receive({ ...signal, payload: { ...signal.payload, id: "late" } });
    expect(args.createNotification).toHaveBeenCalledOnce();
  });
});
