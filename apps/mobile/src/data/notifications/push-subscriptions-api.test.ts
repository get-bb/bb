import { describe, expect, it, vi } from "vitest";
import {
  createPushSubscriptionsApi,
  PUSH_NOTIFICATIONS_PLUGIN_DISABLED_STATUS,
} from "./push-subscriptions-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const subscriptionRef = {
  subscriptionId: "sub_1",
  expoPushToken: "ExponentPushToken[abc]",
  tokenSuffix: "n[abc]",
};

describe("createPushSubscriptionsApi", () => {
  it("resolves the fetch for each server so sealed profiles stay sealed", async () => {
    const sealedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(200, { ok: true, result: { subscriptions: [] } }),
      );
    const plainFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(200, { ok: true, result: { subscriptions: [] } }),
      );
    const api = createPushSubscriptionsApi((serverUrl) =>
      serverUrl === "https://bee.getbb.app" ? sealedFetch : plainFetch,
    );
    await api.list("https://bee.getbb.app/");
    await api.list("http://127.0.0.1:2000");
    expect(sealedFetch).toHaveBeenCalledTimes(1);
    expect(plainFetch).toHaveBeenCalledTimes(1);
    expect(String(sealedFetch.mock.calls[0]?.[0])).toContain(
      "https://bee.getbb.app/api/v1/plugins/push-notifications/rpc/",
    );
  });

  it("registers through the push-notifications plugin RPC", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        result: { id: "sub_1", created: true },
      }),
    );
    const api = createPushSubscriptionsApi(() => fetchImpl);

    await expect(
      api.register("https://bee.getbb.app/", {
        expoPushToken: "ExponentPushToken[abc]",
        platform: "ios",
        deviceLabel: "Sawyer's iPhone",
      }),
    ).resolves.toEqual({ subscriptionId: "sub_1" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://bee.getbb.app/api/v1/plugins/push-notifications/rpc/pushSubscriptions.add",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expoPushToken: "ExponentPushToken[abc]",
          platform: "ios",
          deviceLabel: "Sawyer's iPhone",
        }),
      }),
    );
  });

  it("treats a missing row as already removed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(500, {
        ok: false,
        error: {
          code: "handler_error",
          message: "Push subscription not found: sub_1",
        },
      }),
    );
    const api = createPushSubscriptionsApi(() => fetchImpl);

    await expect(
      api.unregister("https://bee.getbb.app", subscriptionRef),
    ).resolves.toBeUndefined();
  });

  it.each([
    { status: 404, message: "unknown plugin" },
    {
      status: 503,
      message: 'plugin "push-notifications" is not running (status: disabled)',
    },
  ])(
    "maps the unavailable plugin response to the settings status",
    async ({ status, message }) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(status, {
          ok: false,
          error: message,
        }),
      );
      const api = createPushSubscriptionsApi(() => fetchImpl);

      await expect(
        api.register("https://bee.getbb.app", {
          expoPushToken: "ExponentPushToken[abc]",
          platform: "ios",
          deviceLabel: "Sawyer's iPhone",
        }),
      ).rejects.toThrow(PUSH_NOTIFICATIONS_PLUGIN_DISABLED_STATUS);
    },
  );
});
