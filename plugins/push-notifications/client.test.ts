// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientDelivery } from "./client.js";

class TestNotification {
  static permission: NotificationPermission = "granted";
  static instances: TestNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    TestNotification.instances.push(this);
  }
}
const message = {
  id: "event-1",
  title: "Finished",
  body: "Ready",
  threadId: "thread-1",
  channels: ["web"],
};

function stubLocks() {
  const held = new Map<string, number>();
  const queued: (() => void)[] = [];
  const state = {
    paused: false,
    grant() {
      for (const run of queued.splice(0)) run();
    },
  };
  function request(
    name: string,
    ...args:
      | [LockOptions, LockGrantedCallback<unknown>]
      | [LockGrantedCallback<unknown>]
  ): Promise<unknown> {
    const callback = args.length === 2 ? args[1] : args[0];
    const run = async () => {
      held.set(name, (held.get(name) ?? 0) + 1);
      try {
        return await callback(null);
      } finally {
        const count = (held.get(name) ?? 1) - 1;
        if (count === 0) held.delete(name);
        else held.set(name, count);
      }
    };
    if (!state.paused || name !== "bb-notifications-web") return run();
    return new Promise((resolve, reject) =>
      queued.push(() => void run().then(resolve, reject)),
    );
  }
  vi.stubGlobal("navigator", {
    locks: {
      request,
      query: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { held: [...held.keys()].map((name) => ({ name })) };
      },
    },
  });
  return state;
}

beforeEach(() => {
  TestNotification.permission = "granted";
  TestNotification.instances = [];
  localStorage.clear();
  vi.stubGlobal("Notification", TestNotification);
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(window, "focus").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client system notifications", () => {
  it.each([
    { platform: "macos", icon: undefined },
    { platform: "linux", icon: "http://localhost:3000/icon-192.png" },
    { platform: "web", icon: "http://localhost:3000/icon-192.png" },
  ])(
    "uses the appropriate notification icon on $platform",
    async ({ platform, icon }) => {
      if (platform !== "web") vi.stubGlobal("bbDesktop", { platform });
      const delivery = createClientDelivery(vi.fn());
      await delivery.deliver(
        { ...message, channels: [platform === "web" ? "web" : "desktop"] },
        true,
      );
      expect(TestNotification.instances).toHaveLength(1);
      expect(TestNotification.instances[0]?.options.icon).toBe(icon);
      delivery.dispose();
    },
  );

  it.each([
    { platform: "linux", native: true },
    { platform: "macos", native: true },
    { platform: "windows", native: true },
    { platform: "web", native: false },
    { platform: "older-linux", native: false },
  ])(
    "focuses the notification window on $platform",
    async ({ platform, native }) => {
      const focusWindow = vi.fn();
      if (platform !== "web") {
        vi.stubGlobal(
          "bbDesktop",
          platform === "older-linux"
            ? { platform: "linux" }
            : { platform, focusWindow },
        );
      }
      const navigate = vi.fn();
      const delivery = createClientDelivery(navigate);
      await delivery.deliver(
        {
          ...message,
          channels: [platform === "web" ? "web" : "desktop"],
        },
        true,
      );
      expect(focusWindow).not.toHaveBeenCalled();
      const notification = TestNotification.instances[0]!;
      notification.onclick?.();
      expect(focusWindow).toHaveBeenCalledTimes(native ? 1 : 0);
      expect(window.focus).toHaveBeenCalledOnce();
      expect(navigate).toHaveBeenCalledWith(message.threadId);
      expect(notification.close).toHaveBeenCalled();
      delivery.dispose();
    },
  );

  it("suppresses the visible focused thread even while waiting for the cross-window lock", async () => {
    let focused = false;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const locks = stubLocks();
    locks.paused = true;
    const delivery = createClientDelivery(vi.fn(), () => "thread-1");
    const first = delivery.deliver(message, true);
    focused = true;
    locks.grant();
    await first;
    expect(TestNotification.instances).toHaveLength(0);
    focused = false;
    const second = delivery.deliver({ ...message, id: "background" }, true);
    locks.grant();
    await second;
    expect(TestNotification.instances).toHaveLength(1);
    delivery.dispose();
  });

  it("suppresses a thread focused in another window, records it as seen, and resumes after blur", async () => {
    stubLocks();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const focusedWindow = createClientDelivery(vi.fn(), () => "thread-1");
    hasFocus.mockReturnValue(false);
    const backgroundWindow = createClientDelivery(vi.fn(), () => "thread-2");
    await backgroundWindow.deliver(message, true);
    await focusedWindow.deliver(message, true);
    expect(TestNotification.instances).toHaveLength(0);
    window.dispatchEvent(new Event("blur"));
    await focusedWindow.deliver(message, true);
    expect(TestNotification.instances).toHaveLength(0);
    await backgroundWindow.deliver({ ...message, id: "event-2" }, true);
    expect(TestNotification.instances).toHaveLength(1);
    focusedWindow.dispose();
    backgroundWindow.dispose();
  });

  it.each([
    {
      focused: true,
      visible: "visible",
      threadId: "other-thread",
      delivered: true,
    },
    { focused: true, visible: "hidden", threadId: "thread-1", delivered: true },
    {
      focused: true,
      visible: "visible",
      threadId: "thread-1",
      delivered: false,
    },
  ] as const)(
    "matches focus, visibility and thread before suppressing: $threadId / $visible / $focused",
    async ({ focused, visible, threadId, delivered }) => {
      vi.spyOn(document, "hasFocus").mockReturnValue(focused);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue(visible);
      const delivery = createClientDelivery(vi.fn(), () => threadId);
      await delivery.deliver(message, true);
      expect(TestNotification.instances).toHaveLength(delivered ? 1 : 0);
      delivery.dispose();
    },
  );

  it("deduplicates windows whose stored seen list has not caught up", async () => {
    stubLocks();
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    const first = createClientDelivery(vi.fn());
    const second = createClientDelivery(vi.fn());
    await first.deliver(message, true);
    await second.deliver(message, true);
    expect(TestNotification.instances).toHaveLength(1);
    first.dispose();
    second.dispose();
  });

  it("deduplicates windows, navigates on click, and cleans up on disposal", async () => {
    const navigate = vi.fn();
    const first = createClientDelivery(navigate);
    const second = createClientDelivery(navigate);
    await first.deliver(message, true);
    await second.deliver(message, true);
    expect(TestNotification.instances).toHaveLength(1);
    const notification = TestNotification.instances[0]!;
    expect(notification.options.body).toBe("Ready");
    notification.onclick?.();
    expect(window.focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("thread-1");
    await first.deliver({ ...message, id: "event-2" }, true);
    first.dispose();
    expect(TestNotification.instances[1]?.close).toHaveBeenCalled();
    await first.deliver({ ...message, id: "event-3" }, true);
    expect(TestNotification.instances).toHaveLength(2);
    second.dispose();
  });

  it("respects channel, permission, disabled state, and malformed input", async () => {
    const delivery = createClientDelivery(vi.fn());
    await delivery.deliver(message, false);
    await delivery.deliver({ ...message, channels: ["desktop"] }, true);
    await delivery.deliver({ ...message, threadId: 3 }, true);
    TestNotification.permission = "denied";
    await delivery.deliver(message, true);
    expect(TestNotification.instances).toHaveLength(0);
    vi.stubGlobal("bbDesktop", {});
    TestNotification.permission = "granted";
    await delivery.deliver(message, true);
    await delivery.deliver({ ...message, channels: ["desktop"] }, true);
    expect(TestNotification.instances).toHaveLength(1);
    delivery.dispose();
  });

  it("does not deliver in the mobile WebView and survives unavailable storage", async () => {
    const delivery = createClientDelivery(vi.fn());
    vi.stubGlobal("bb", { native: {} });
    await delivery.deliver(message, true);
    expect(TestNotification.instances).toHaveLength(0);
    vi.stubGlobal("bb", undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Unavailable");
    });
    await delivery.deliver(message, true);
    expect(TestNotification.instances).toHaveLength(1);
    delivery.dispose();
  });
});
