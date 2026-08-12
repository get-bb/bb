import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import {
  createFirmwareCommandHandlers,
  registerFirmware,
} from "../register.js";

const firmwareMethods = [
  "firmwareDiff",
  "firmwareFileGet",
  "firmwareFileHydrate",
  "firmwareMaterializeCancel",
  "firmwareMaterializeStart",
  "firmwareMountGet",
  "firmwareMountsList",
  "firmwareTreeList",
];

describe("firmware registration", () => {
  it("registers frozen RPC and background seams reload-safely", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    registerFirmware(host.bb, createPluginContext(host.bb));
    expect([...host.harness.registrations.rpcMethods].sort()).toEqual(firmwareMethods);
    expect(host.harness.registrations.services.map((service) => service.name)).toEqual([
      "firmware-materialization",
    ]);

    const replacement = await host.harness.lifecycle.reload((bb) => {
      registerFirmware(bb, createPluginContext(bb));
    });
    expect([...replacement.harness.registrations.rpcMethods].sort()).toEqual(firmwareMethods);
    await replacement.harness.lifecycle.dispose();
  });

  it("does not accept CLI cwd as an execution identity", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const handlers = createFirmwareCommandHandlers(createPluginContext(host.bb));
    await expect(
      handlers.resolveScope(
        { cwd: "/tmp/untrusted" },
        { projectId: "project-1", projectVersionId: "pv-1", generationId: "gen-1" },
      ),
    ).rejects.toThrow(/invoke from a bb thread/iu);
    await host.harness.lifecycle.dispose();
  });
});
