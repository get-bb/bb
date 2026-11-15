import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  cookies: vi.fn(async () => undefined),
  dismiss: vi.fn(async () => undefined),
  category: vi.fn(async () => null),
}));

vi.mock("expo-notifications", () => ({
  dismissNotificationAsync: native.dismiss,
  setNotificationCategoryAsync: native.category,
}));
vi.mock("@/lib/native/cookie-store", () => ({
  nativeCookieStore: { set: native.cookies },
}));
vi.mock("@/lib/native/preferences-storage", () => ({
  getPreferencesStorage: () => ({
    getString: (key: string) => native.entries.get(key),
    set: (key: string, value: string) => {
      native.entries.set(key, value);
    },
    remove: (key: string) => {
      native.entries.delete(key);
    },
  }),
}));
vi.mock("@/lib/native/profile-store", () => ({
  getProfileStore: () => ({
    load: async () => ({
      profiles: [
        {
          id: "profile-1",
          mode: "connect",
          serverUrl: "https://bb.example.test",
          handle: "bb",
          credential: "test-credential",
        },
      ],
    }),
  }),
}));
vi.mock("./push-storage", () => ({
  getPushStore: () => ({
    reload: () => undefined,
    getSnapshot: () => ({
      registrations: { "profile-1": { subscriptionId: "subscription-1" } },
    }),
  }),
}));

import {
  handleNotificationReply,
  registerNotificationReplyCategory,
} from "./notification-reply";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native notification reply delivery", () => {
  it("renews Connect authentication and sends the reply through the normal SDK route", async () => {
    const requestFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/connect/desktop-session")) {
        expect(new Headers(init?.headers).get("x-bb-connect-machine")).toBe(
          "test-credential",
        );
        return Response.json({
          cookie: {
            domain: "bb.example.test",
            expiresAt: Date.now() + 60_000,
            name: "session",
            value: "test-session",
          },
        });
      }
      expect(native.cookies).toHaveBeenCalledTimes(2);
      expect(url).toBe("https://bb.example.test/api/v1/threads/thread-1/send");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        input: [{ type: "text", text: "Continue" }],
        mode: "queue-if-active",
      });
      return Response.json({ ok: true, delivery: "sent" });
    });
    vi.stubGlobal("fetch", requestFetch);
    await registerNotificationReplyCategory();
    expect(native.category).toHaveBeenCalledWith("bb-thread-reply", [
      expect.objectContaining({
        identifier: "bb-reply",
        textInput: {
          submitButtonTitle: "Send",
          placeholder: "Message this thread",
        },
        options: { opensAppToForeground: true, isAuthenticationRequired: true },
      }),
    ]);
    expect(
      await handleNotificationReply({
        actionIdentifier: "bb-reply",
        userText: "Continue",
        notification: {
          request: {
            identifier: "request-1",
            content: {
              data: { threadId: "thread-1", subscriptionId: "subscription-1" },
            },
          },
        },
      }),
    ).toBe(true);
    expect(requestFetch).toHaveBeenCalledTimes(2);
    expect(native.dismiss).toHaveBeenCalledWith("request-1");
  });
});
