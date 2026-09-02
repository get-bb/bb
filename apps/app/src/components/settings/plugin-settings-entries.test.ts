import { describe, expect, it } from "vitest";
import { buildPluginSettingsEntries } from "./plugin-settings-entries";

describe("buildPluginSettingsEntries", () => {
  it("separates configurable plugins while preserving the full catalog", () => {
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

    expect(entries.all).toEqual([
      { icon: null, id: "disabled", label: "Disabled" },
      { icon: "linear-icon", id: "linear", label: "Linear" },
      { icon: null, id: "plain", label: "Plain" },
      { icon: null, id: "workflows", label: "workflows" },
    ]);
    expect(entries.configurable).toEqual([
      { icon: "linear-icon", id: "linear", label: "Linear" },
      { icon: null, id: "workflows", label: "workflows" },
    ]);
    expect(entries.other).toEqual([
      { icon: null, id: "disabled", label: "Disabled" },
      { icon: null, id: "plain", label: "Plain" },
    ]);
  });
});
