import { describe, expect, it, vi } from "vitest";
import {
  createPushSubscriptionsApi,
  PUSH_NOTIFICATIONS_PLUGIN_DISABLED_STATUS,
} from "./push-subscriptions-api";

const subscriptionRef = {
  subscriptionId: "sub_1",
  expoPushToken: "ExponentPushToken[abc]",
  tokenSuffix: "n[abc]",
};

describe("createPushSubscriptionsApi", () => {
  it("registers through the push-notifications plugin RPC", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        result: { id: "sub_1", created: true },
      }),
    );
    const api = createPushSubscriptionsApi(fetchImpl);

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
      Response.json(
        {
          ok: false,
          error: {
            code: "handler_error",
            message: "Push subscription not found: sub_1",
          },
        },
        { status: 500 },
      ),
    );
    const api = createPushSubscriptionsApi(fetchImpl);

    await expect(
      api.unregister("https://bee.getbb.app", subscriptionRef),
    ).resolves.toBeUndefined();
  });

  it.each([
    { status: 404, error: "unknown plugin" },
    {
      status: 503,
      error: 'plugin "push-notifications" is not running (status: disabled)',
    },
    {
      status: 404,
      error: {
        code: "plugin_not_found",
        message: 'unknown plugin "push-notifications"',
      },
    },
    {
      status: 503,
      error: {
        code: "plugin_not_running",
        message:
          'plugin "push-notifications" is not running (status: disabled)',
      },
    },
  ])(
    "maps the unavailable plugin response to the settings status",
    async ({ status, error }) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ ok: false, error }, { status }));
      const api = createPushSubscriptionsApi(fetchImpl);

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
