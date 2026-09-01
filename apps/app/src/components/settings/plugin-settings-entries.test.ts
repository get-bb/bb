import { describe, expect, it } from "vitest";
import { buildPluginSettingsEntries } from "./plugin-settings-entries";

describe("buildPluginSettingsEntries", () => {
  it("includes enabled plugins with declarative or custom settings", () => {
    const entries = buildPluginSettingsEntries({
      installedPlugins: [
        {
          enabled: true,
          hasSettings: false,
          icon: null,
          id: "workflows",
          name: null,
        },
        {
          enabled: false,
          hasSettings: true,
          icon: null,
          id: "disabled",
          name: "Disabled",
        },
        {
          enabled: true,
          hasSettings: true,
          icon: "linear-icon",
          id: "linear",
          name: "Linear",
        },
      ],
      settingsSections: [{ pluginId: "workflows" }],
    });

    expect(entries).toEqual([
      { icon: "linear-icon", id: "linear", label: "Linear" },
      { icon: null, id: "workflows", label: "workflows" },
    ]);
  });
});
