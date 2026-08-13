import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import {
  helperInstallGateAudit,
  proposeHelperInstall,
} from "../gating/helper-install.js";
import { registerDebugBench } from "../register.js";
import type { FamilyDescriptor } from "./families.js";
import { upsertCandidate } from "./store.js";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});

describe("debug-bench registration", () => {
  it("routes helper installation through server-issued interaction and stays absent from agent tools", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state-helper-rpc" });
    disposals.push(() => harness.lifecycle.dispose());
    const ctx = createPluginContext(bb);
    registerDebugBench(bb, ctx);
    const family: FamilyDescriptor = {
      id: "fixture-helper-family",
      kind: "probe",
      label: "Fixture helper",
      detectionStrategy: "fixture",
      helper: {
        id: "fixture-helper",
        displayName: "Fixture helper",
        source: "https://example.test/helper",
        why: "Exercise the production confirmation path.",
        check: ["/usr/bin/true"],
        install: ["/usr/bin/true"],
      },
      transports: ["local-usb"],
    };
    const proposal = proposeHelperInstall(ctx.db(), family);
    const installation = harness.behavior.callRpc("benchDevHelperInstall", {
      projectId: "project-1",
      projectVersionId: null,
      proposalToken: proposal.proposalToken,
      threadId: "thread-1",
    });
    await vi.waitFor(() => expect(harness.pendingInteractions).toHaveLength(1));
    expect(harness.inspection.registrations.agentTools.map((tool) => tool.name))
      .not.toContain("benchDevHelperInstall");
    harness.submitInteraction(harness.pendingInteractions[0]!.id, { confirmed: true });

    await expect(installation).resolves.toMatchObject({
      state: "installed",
      confirmedBy: expect.stringMatching(/^request-input-response:thread-1:/),
    });
    expect(helperInstallGateAudit({
      db: ctx.db(),
      sessionId: "thread-1",
    }, proposal.proposalToken)).toMatchObject({
      callerOrigin: "bb.ui.requestInput",
      outcome: "installed",
    });
  });

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
      holder: "thread-fleet",
      claimScope: "fleet",
    })).rejects.toThrow("CLAIM_SCOPE_NOT_IMPLEMENTED");
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
