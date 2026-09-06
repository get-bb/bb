import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import browserPlugin from "./server.js";

describe("Browser plugin registration", () => {
  it("registers an agent tool with a provider-safe input schema", () => {
    const host = createFakePluginHost({ pluginId: "browser" });

    expect(() => browserPlugin(host.bb)).not.toThrow();
    expect(host.harness.registrations.agentTools.map((tool) => tool.name)).toEqual([
      "bb_browser",
    ]);
  });
});
