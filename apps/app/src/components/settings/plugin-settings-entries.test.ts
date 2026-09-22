import { describe, expect, it } from "vitest";
import { buildPluginSettingsEntries } from "./plugin-settings-entries";

describe("buildPluginSettingsEntries", () => {
  it("includes enabled and disabled plugins with declared or custom settings", () => {
    const installedPlugins = [
      {
        enabled: true,
        hasSettings: false,
        icon: null,
        id: "workflows",
        name: null,
      },
      {
        enabled: false,
        hasSettings: false,
        icon: null,
        id: "disabled",
        name: "Disabled",
      },
      {
        enabled: false,
        hasSettings: true,
        icon: null,
        id: "disabled-configurable",
        name: "Disabled configurable",
      },
      {
        enabled: true,
        hasSettings: true,
        icon: "linear-icon",
        id: "linear",
        name: "Linear",
      },
      {
        enabled: true,
        hasSettings: false,
        icon: null,
        id: "plain",
        name: "Plain",
      },
    ];
    const entries = buildPluginSettingsEntries({
      installedPlugins,
      settingsSections: [{ pluginId: "workflows" }],
    });

    expect(entries).toEqual([
      { icon: null, id: "disabled-configurable", label: "Disabled configurable" },
      { icon: "linear-icon", id: "linear", label: "Linear" },
      { icon: null, id: "workflows", label: "workflows" },
    ]);
  });
});
