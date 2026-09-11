import { expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { registerUsageSource } from "./usage-source.js";
import {
  usageMeasurementSchema,
  usageResourceListSchema,
  usageListMethod,
  usageFetchMethod,
} from "./usage-contract.js";

it("publishes usage independently of displays and isolates disconnected hosts", async () => {
  const collect = vi.fn(async () => ({
    codex: {
      status: "ok" as const,
      accountEmail: "user@example.com",
      planLabel: "Team",
      windows: [{ label: "Weekly", usedPercent: 42, resetsAt: null }],
    },
  }));
  const { bb, harness } = createFakePluginHost({
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "online", status: "connected" }),
          makeHostResponse({ id: "offline", status: "disconnected" }),
        ],
      },
      system: { usageLimits: collect },
    },
  });
  try {
    registerUsageSource(bb);
    const inventory = usageResourceListSchema.parse(
      await harness.behavior.callRpc(usageListMethod, {}),
    );
    expect(inventory.resources.map((resource) => resource.id)).toEqual([
      "online",
      "offline",
    ]);
    expect(collect).not.toHaveBeenCalled();
    const read = async (resourceId: string, refresh: boolean) =>
      usageMeasurementSchema.parse(
        await harness.behavior.callRpc(usageFetchMethod, {
          resourceId,
          refresh,
        }),
      );
    expect(await read("online", false)).toMatchObject({
      usage: { status: "ok", windows: [{ usedPercent: 42 }] },
    });
    expect(collect).toHaveBeenCalledWith({
      hostId: "online",
      providerId: "codex",
    });
    await read("online", false);
    expect(collect).toHaveBeenCalledTimes(1);
    await read("online", true);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(await read("offline", false)).toMatchObject({
      observedAt: null,
      usage: { status: "error" },
    });
    expect(collect).toHaveBeenCalledTimes(2);
    await expect(read("removed", false)).rejects.toThrow("no longer exists");
  } finally {
    await harness.lifecycle.dispose();
  }
});
