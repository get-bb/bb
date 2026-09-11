import { expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import {
  usageListMethod,
  usageFetchMethod,
  usageMeasurementSchema,
  usageResourceListSchema,
} from "./usage-contract.js";

it("adapts arbitrary maintenance providers without a display and only measures the requested resource", async () => {
  const collect = vi.fn(async () => ({
    custom: {
      status: "ok" as const,
      accountEmail: "same@example.com",
      planLabel: "Custom subscription",
      windows: [
        { label: "Tokens this month", usedPercent: 42, resetsAt: null },
      ],
    },
  }));
  let removed = false;
  const { bb, harness } = createFakePluginHost({
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "online", status: "connected" }),
          makeHostResponse({ id: "offline", status: "disconnected" }),
        ],
      },
      providers: {
        list: async () =>
          removed
            ? []
            : [
                { id: "custom", displayName: "Custom" },
                { id: "another", displayName: "Another" },
              ],
      },
      system: { usageLimits: collect },
    },
  });
  try {
    plugin(bb);
    const list = async () =>
      usageResourceListSchema.parse(
        await harness.behavior.callRpc(usageListMethod, {}),
      );
    const read = async (host: string, provider: string, refresh = false) =>
      usageMeasurementSchema.parse(
        await harness.behavior.callRpc(usageFetchMethod, {
          resourceId: JSON.stringify([host, provider]),
          refresh,
        }),
      );
    expect((await list()).resources).toHaveLength(4);
    expect(collect).not.toHaveBeenCalled();
    expect(await read("online", "custom")).toMatchObject({
      accountKey: null,
      usage: {
        status: "ok",
        plan: null,
        planLabel: "Custom subscription",
        windows: [{ kind: "custom", label: "Tokens this month" }],
      },
    });
    expect(collect).toHaveBeenCalledWith({
      hostId: "online",
      providerId: "custom",
    });
    await read("online", "custom");
    expect(collect).toHaveBeenCalledTimes(1);
    await read("online", "custom", true);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(await read("offline", "custom")).toMatchObject({
      observedAt: null,
      usage: { status: "error" },
    });
    expect(collect).toHaveBeenCalledTimes(2);
    removed = true;
    expect((await list()).resources).toEqual([]);
    await expect(read("online", "custom")).rejects.toThrow("no longer exists");
  } finally {
    await harness.lifecycle.dispose();
  }
});

it("forwards validated provider-owned identity and normalization metadata while tolerating older providers", async () => {
  const { bb, harness } = createFakePluginHost({
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host", status: "connected" }),
        ],
      },
      providers: {
        list: async () => [{ id: "custom", displayName: "Custom" }],
      },
      system: {
        usageLimits: async () => ({
          custom: {
            status: "ok",
            accountKey: "issuer:organization:123",
            accountEmail: "same@example.com",
            planLabel: "max",
            plan: { id: "max", multiplier: 20 },
            windows: [
              {
                label: "168 hour window",
                kind: "weekly",
                model: "fable",
                usedPercent: 50,
                resetsAt: null,
              },
            ],
          },
        }),
      },
    },
  });
  try {
    plugin(bb);
    const value = usageMeasurementSchema.parse(
      await harness.behavior.callRpc(usageFetchMethod, {
        resourceId: JSON.stringify(["host", "custom"]),
        refresh: false,
      }),
    );
    expect(value).toMatchObject({
      accountKey: "issuer:organization:123",
      usage: {
        plan: { id: "max", multiplier: 20 },
        windows: [{ kind: "weekly", model: "fable" }],
      },
    });
    const inventory = usageResourceListSchema.parse(
      await harness.behavior.callRpc(usageListMethod, {}),
    );
    expect(inventory.resources[0]?.accountKey).toBe(value.accountKey);
  } finally {
    await harness.lifecycle.dispose();
  }
});

it("coalesces concurrent reads and makes a forced refresh wait for a fresh collection", async () => {
  let finish: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const collect = vi.fn(async () => {
    await gate;
    return {
      custom: {
        status: "ok" as const,
        accountEmail: null,
        planLabel: null,
        windows: [],
      },
    };
  });
  const { bb, harness } = createFakePluginHost({
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host", status: "connected" }),
        ],
      },
      providers: {
        list: async () => [{ id: "custom", displayName: "Custom" }],
      },
      system: { usageLimits: collect },
    },
  });
  try {
    plugin(bb);
    const read = (refresh: boolean) =>
      harness.behavior.callRpc(usageFetchMethod, {
        resourceId: JSON.stringify(["host", "custom"]),
        refresh,
      });
    const first = read(false);
    const second = read(false);
    const forced = read(true);
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    finish!();
    await Promise.all([first, second, forced]);
    expect(collect).toHaveBeenCalledTimes(2);
  } finally {
    finish?.();
    await harness.lifecycle.dispose();
  }
});
