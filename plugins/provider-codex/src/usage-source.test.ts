import { expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { registerUsageSource } from "./usage-source.js";
import { usageSnapshotSchema } from "./usage-contract.js";

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
    expect(
      harness.registrations.experimental_publishedRpcMethods.map(
        (item) => item.method,
      ),
    ).toEqual(["provider-usage.v1.get"]);
    const read = async (refresh: boolean) =>
      usageSnapshotSchema.parse(
        await harness.behavior.callRpc("provider-usage.v1.get", { refresh }),
      );
    const result = await read(false);
    expect(result.resources[0]).toMatchObject({
      providerId: "codex",
      scope: { kind: "host", hostId: "online" },
      usage: { status: "ok", windows: [{ usedPercent: 42 }] },
    });
    expect(result.resources[1]).toMatchObject({
      observedAt: null,
      usage: { status: "error" },
    });
    await read(false);
    expect(collect).toHaveBeenCalledTimes(1);
    await read(true);
    expect(collect).toHaveBeenCalledTimes(2);
  } finally {
    await harness.lifecycle.dispose();
  }
});
