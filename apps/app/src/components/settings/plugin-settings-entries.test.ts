import { describe, expect, it } from "vitest";
import { buildPluginSettingsEntries } from "./plugin-settings-entries";

describe("buildPluginSettingsEntries", () => {
  it("includes every installed plugin regardless of runtime configuration", () => {
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
    const entries = buildPluginSettingsEntries({ installedPlugins });

    expect(entries).toEqual([
      { icon: null, id: "disabled", label: "Disabled" },
      { icon: "linear-icon", id: "linear", label: "Linear" },
      { icon: null, id: "plain", label: "Plain" },
      { icon: null, id: "workflows", label: "workflows" },
    ]);
  });
});
