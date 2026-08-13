import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { registerDebugBench } from "../register.js";
import { upsertCandidate } from "./store.js";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});

describe("debug-bench registration", () => {
  it("round-trips frozen device fields and publishes committed claim hints", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
    disposals.push(() => harness.lifecycle.dispose());
    const ctx = createPluginContext(bb);
    registerDebugBench(bb, ctx);
    const scope = { projectId: "project-1", projectVersionId: "version-1" };
    const device = upsertCandidate(ctx.db(), scope, "scope-lan", "scope", {
      stableIdentity: "scope-serial",
      make: "Siglent",
      model: "SDS",
      connection: "lan:192.0.2.10:5025",
      transport: "local-net",
    }, "2026-08-13T10:00:00.000Z");

    await expect(harness.behavior.callRpc("benchDevDevicesList", {
      ...scope,
      pageSize: 50,
      cursor: null,
      includeStale: true,
    })).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({
        deviceId: device.deviceId,
        transport: "local-net",
        claimScope: "machine",
        stale: false,
      })],
    });
    await expect(harness.behavior.callRpc("benchDevDeviceClaim", {
      ...scope,
      deviceId: device.deviceId,
      holder: "thread-1",
      claimScope: "machine",
    })).resolves.toMatchObject({
      outcome: "claimed",
      device: expect.objectContaining({ claimedBy: "thread-1", transport: "local-net" }),
    });
    await expect(harness.behavior.callRpc("benchDevDeviceRelease", {
      ...scope,
      deviceId: device.deviceId,
      holder: "thread-1",
    })).resolves.toMatchObject({ outcome: "released" });
    expect(harness.inspection.realtimeSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "benchDev:changed", payload: { deviceId: device.deviceId } }),
    ]));
    expect(harness.inspection.registrations.rpcMethods).toEqual(expect.arrayContaining([
      "benchDevDevicesList",
      "benchDevDeviceClaim",
      "benchDevDeviceRelease",
      "benchDevRegistryStatus",
      "benchDevRegistryRescan",
    ]));
  });
});
