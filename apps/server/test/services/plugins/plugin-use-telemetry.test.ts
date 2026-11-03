import { describe, expect, it, vi } from "vitest";
import { upsertInstalledPlugin, type PluginProvenance } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  capturePluginUse,
  forgetPluginRecommendation,
  rememberPluginRecommendation,
} from "../../../src/services/plugins/plugin-use-telemetry.js";
import type { TelemetryService } from "../../../src/services/system/telemetry.js";

function arrange(enabled = true) {
  const db = createMigratedConnection();
  const install = (id: string, provenance: PluginProvenance) =>
    upsertInstalledPlugin(db, {
      id,
      source: `builtin:${id}`,
      provenance,
      sourceIntent: { kind: "builtin", name: id },
      exactResolution: { kind: "builtin" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: `/plugins/${id}`,
      version: "1.0.0",
      enabled: true,
      enabledFollowsDefault: false,
    });
  install("workflows", {
    kind: "catalog",
    marketplace: "bb-official",
    entryId: "workflows",
  });
  install("private-tool", { kind: "direct" });
  const capture = vi.fn<TelemetryService["capture"]>();
  const telemetry: TelemetryService = {
    capture,
    isEnabled: () => enabled,
    setEnabled: () => {},
    featureFlagIdentity: () => null,
    setSharedProperty: () => {},
  };
  return { deps: { db, telemetry }, capture };
}

describe("plugin use telemetry", () => {
  it("counts a plugin once a day and credits a selection on its next use", () => {
    const { deps, capture } = arrange();
    capturePluginUse(deps, "workflows");
    capturePluginUse(deps, "workflows");
    rememberPluginRecommendation(deps, "workflows", "rec_123456789012345678");
    capturePluginUse(deps, "workflows");
    capturePluginUse(deps, "workflows");

    expect(capture.mock.calls.map(([event]) => event)).toEqual([
      { name: "plugin_use", properties: { plugin_id: "workflows" } },
      { name: "plugin_use", properties: { plugin_id: "workflows" } },
      {
        name: "recommendation",
        properties: {
          resource_type: "plugin",
          resource_id: "workflows",
          recommendation_id: "rec_123456789012345678",
          action: "used",
        },
      },
    ]);
  });

  it("does not credit a recommendation after the plugin is turned off", () => {
    const { deps, capture } = arrange();
    rememberPluginRecommendation(deps, "workflows", "rec_123456789012345678");
    forgetPluginRecommendation(deps.db, "workflows");

    capturePluginUse(deps, "workflows");

    expect(capture).toHaveBeenCalledExactlyOnceWith({
      name: "plugin_use",
      properties: { plugin_id: "workflows" },
    });
  });

  it("sends nothing for private plugins or when usage data is off", () => {
    const shared = arrange();
    capturePluginUse(shared.deps, "private-tool");
    expect(shared.capture).not.toHaveBeenCalled();

    const optedOut = arrange(false);
    rememberPluginRecommendation(
      optedOut.deps,
      "workflows",
      "rec_123456789012345678",
    );
    capturePluginUse(optedOut.deps, "workflows");
    optedOut.deps.telemetry.isEnabled = () => true;
    capturePluginUse(optedOut.deps, "workflows");
    expect(optedOut.capture).toHaveBeenCalledExactlyOnceWith({
      name: "plugin_use",
      properties: { plugin_id: "workflows" },
    });
  });
});
