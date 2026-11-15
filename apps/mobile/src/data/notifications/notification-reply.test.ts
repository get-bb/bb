import { describe, expect, it, vi } from "vitest";
import {
  createNotificationReplyHandler,
  THREAD_REPLY_ACTION,
} from "./notification-reply";

function setup() {
  const entries = new Map<string, string>();
  const send = vi.fn(async () => undefined);
  const dismiss = vi.fn(async () => undefined);
  const profiles = [
    {
      id: "first",
      serverUrl: "https://first.test",
      label: "First",
      createdAt: 1,
      mode: "direct" as const,
    },
    {
      id: "second",
      serverUrl: "https://second.test",
      label: "Second",
      createdAt: 1,
      mode: "direct" as const,
    },
  ];
  const deps = {
    storage: {
      getString: (key: string) => entries.get(key),
      set: (key: string, value: string) => {
        entries.set(key, value);
      },
      remove: (key: string) => {
        entries.delete(key);
      },
    },
    getProfiles: async () => profiles,
    getRegistrations: () => ({ second: { subscriptionId: "subscription-2" } }),
    send,
    dismiss,
  };
  return {
    deps,
    profiles,
    send,
    dismiss,
    handle: createNotificationReplyHandler(deps),
  };
}

function response(
  identifier = "notification-1",
  userText = "  Continue with the fix  ",
) {
  return {
    actionIdentifier: THREAD_REPLY_ACTION,
    userText,
    notification: {
      request: {
        identifier,
        content: {
          data: {
            threadId: "thread-2",
            subscriptionId: "subscription-2",
            serverUrl: "https://untrusted.test",
          },
        },
      },
    },
  };
}

describe("notification replies", () => {
  it("sends text only to the saved server matching the subscription and dismisses after delivery", async () => {
    const host = setup();
    expect(await host.handle(response())).toBe(true);
    expect(host.send).toHaveBeenCalledWith(
      host.profiles[1],
      "thread-2",
      "Continue with the fix",
    );
    expect(host.dismiss).toHaveBeenCalledWith("notification-1");
    expect(host.send.mock.invocationCallOrder[0]).toBeLessThan(
      host.dismiss.mock.invocationCallOrder[0]!,
    );
  });

  it("deduplicates concurrent callbacks and replays after the handler is recreated", async () => {
    const host = setup();
    await Promise.all([
      host.handle(response()),
      host.handle(response()),
      host.handle(response("notification-2")),
    ]);
    const recreated = createNotificationReplyHandler(host.deps);
    await recreated(response());
    await recreated(response("notification-2"));
    expect(host.send).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    response("notification-1", "  "),
    { ...response(), actionIdentifier: "default" },
    {
      ...response(),
      notification: { request: { identifier: "test", content: { data: {} } } },
    },
  ])("ignores non-replies and malformed payloads", async (payload) => {
    const host = setup();
    expect(await host.handle(payload)).toBe(false);
    expect(host.send).not.toHaveBeenCalled();
  });

  it("refuses a removed server without sending to another profile", async () => {
    const host = setup();
    host.profiles.pop();
    await expect(host.handle(response())).rejects.toThrow("no longer saved");
    expect(host.send).not.toHaveBeenCalled();
    expect(host.dismiss).not.toHaveBeenCalled();
  });

  it("keeps a failed reply retryable and only records successful delivery", async () => {
    const host = setup();
    host.send.mockRejectedValueOnce(new Error("offline"));
    await expect(host.handle(response())).rejects.toThrow("offline");
    expect(host.dismiss).not.toHaveBeenCalled();
    expect(await host.handle(response())).toBe(true);
    expect(host.send).toHaveBeenCalledTimes(2);
  });

  it.each(["storage", "dismissal"])(
    "reports delivery success even when %s cleanup fails",
    async (failure) => {
      const host = setup();
      if (failure === "storage") {
        host.deps.storage.set = () => {
          throw new Error("storage unavailable");
        };
      } else {
        host.dismiss.mockRejectedValueOnce(
          new Error("notification unavailable"),
        );
      }
      await expect(host.handle(response())).resolves.toBe(true);
      await expect(host.handle(response())).resolves.toBe(true);
      expect(host.send).toHaveBeenCalledTimes(1);
    },
  );
});
