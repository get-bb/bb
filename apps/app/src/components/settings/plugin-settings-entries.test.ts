import { describe, expect, it } from "vitest";
import {
  buildPluginSettingsEntries,
  type PluginSettingsCandidate,
} from "./plugin-settings-entries";

function candidate(
  overrides: Partial<PluginSettingsCandidate> & { id: string },
): PluginSettingsCandidate {
  return {
    enabled: true,
    hasSettings: false,
    icon: null,
    name: null,
    status: "running",
    ...overrides,
  };
}

describe("buildPluginSettingsEntries", () => {
  it("only includes enabled plugins with declared or custom settings", () => {
    const entries = buildPluginSettingsEntries({
      installedPlugins: [
        candidate({ id: "workflows" }),
        candidate({ enabled: false, id: "disabled", name: "Disabled" }),
        candidate({
          hasSettings: true,
          icon: "linear-icon",
          id: "linear",
          name: "Linear",
        }),
        candidate({ id: "plain", name: "Plain" }),
      ],
      settingsSections: [{ pluginId: "workflows" }],
    });

    expect(entries).toEqual([
      {
        hasSettingsForm: true,
        icon: "linear-icon",
        id: "linear",
        label: "Linear",
      },
      {
        hasSettingsForm: false,
        icon: null,
        id: "workflows",
        label: "workflows",
      },
    ]);
  });

  it("reports a settings form only while the plugin's status shows one", () => {
    const entries = buildPluginSettingsEntries({
      installedPlugins: [
        candidate({ hasSettings: true, id: "ready", status: "running" }),
        candidate({
          hasSettings: true,
          id: "unconfigured",
          status: "needs-configuration",
        }),
        candidate({ hasSettings: true, id: "broken", status: "error" }),
      ],
      settingsSections: [],
    });

    expect(entries.map((entry) => [entry.id, entry.hasSettingsForm])).toEqual([
      ["broken", false],
      ["ready", true],
      ["unconfigured", true],
    ]);
  });
});
