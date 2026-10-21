import { describe, expect, it } from "vitest";
import { BUNDLED_PLUGINS } from "../../../src/services/plugins/builtin-registry.js";
import { BUILTIN_PLUGIN_CAPABILITIES } from "../../../src/services/plugins/plugin-feature-telemetry.js";

describe("built-in plugin capabilities", () => {
  it("are keyed by installed bundled plugin ids", () => {
    const bundledIds = new Set(
      BUNDLED_PLUGINS.map((plugin) => plugin.pluginId),
    );
    expect(
      Object.keys(BUILTIN_PLUGIN_CAPABILITIES).filter(
        (pluginId) => !bundledIds.has(pluginId),
      ),
    ).toEqual([]);
  });

  it.each([
    ["simple-notes", "file"],
    ["bb--storage-retention", "settings"],
    ["bb--provider-usage", "provider"],
    ["provider-acp", "provider"],
  ])("reports %s as %s", (pluginId, feature) => {
    expect(BUILTIN_PLUGIN_CAPABILITIES[pluginId]).toBe(feature);
  });
});
