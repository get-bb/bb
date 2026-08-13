import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lanes/hardware/register.js", () => ({
  registerHardware: () => undefined,
}));

import plugin from "../server.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("plugin status gate", () => {
  it("stays running with valid credentials and no firmware toolchain binaries", async () => {
    vi.stubEnv("PATH", "");
    const host = createFakePluginHost({
      pluginId: `finite-state-toolchain-gate-${crypto.randomUUID()}`,
      settings: {
        platformBaseUrl: "https://platform.example",
        platformToken: "valid-platform-token",
        asBaseUrl: "https://assurance.example",
        asApiKey: "valid-assurance-key",
      },
    });
    hosts.push(host);

    await plugin(host.bb);
    const service = host.harness.behavior.runService("authoring-build-supervisor");
    await vi.waitFor(async () => {
      await expect(
        host.harness.behavior.callRpc("authoringToolchainStatus", null),
      ).resolves.toEqual(expect.objectContaining({ state: "unavailable" }));
    });

    expect(host.harness.inspection.needsConfigurationMessages).toEqual([]);
    service.controller.abort();
    await service.done;
  });
});
