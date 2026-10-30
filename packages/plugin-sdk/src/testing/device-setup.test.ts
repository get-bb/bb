import { describe, expect, it } from "vitest";
import type { ConnectDeviceSetupProperties } from "@bb/server-contract";
import { createFakePluginHost } from "./fake-plugin-host.js";

const properties: ConnectDeviceSetupProperties = {
  step: "devices",
  resource_type: "device",
  resource_id: "browser_access",
  operation: "enable",
  outcome: "succeeded",
  surface: "unknown",
  entry: null,
  error_category: null,
};

describe("internal Connect measurement harness", () => {
  it("records valid owner milestones and rejects private fields, nonowners and stale handles", async () => {
    const connect = createFakePluginHost({ pluginId: "connect" });
    const other = createFakePluginHost({ pluginId: "private" });
    try {
      connect.bb.internal_DO_NOT_USE_recordDeviceSetup(properties);
      expect(connect.harness.internal_DO_NOT_USE_deviceSetupEvents).toEqual([
        properties,
      ]);
      expect(() =>
        other.bb.internal_DO_NOT_USE_recordDeviceSetup(properties),
      ).toThrow(/restricted/);
      expect(() =>
        Reflect.apply(connect.bb.internal_DO_NOT_USE_recordDeviceSetup, null, [
          { ...properties, hostId: "private" },
        ]),
      ).toThrow();
    } finally {
      await connect.harness.lifecycle.dispose();
      await other.harness.lifecycle.dispose();
    }
    expect(() =>
      connect.bb.internal_DO_NOT_USE_recordDeviceSetup(properties),
    ).toThrow();
  });
});
