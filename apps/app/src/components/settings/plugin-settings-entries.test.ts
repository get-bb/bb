import { describe, expect, it } from "vitest";
import type { PluginAppOnDemandSurface } from "@bb/domain";
import {
  buildPluginSettingsEntries,
  type PluginSettingsCandidate,
} from "./plugin-settings-entries";

function deferredApp(
  onDemandSurfaces: PluginAppOnDemandSurface[],
  compatible = true,
): PluginSettingsCandidate["app"] {
  return {
    hasApp: true,
    bundle: {
      jsUrl: "/app.js",
      cssUrl: null,
      jsBytes: 1,
      hash: "h",
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible,
      runtimeSlots: [],
      onDemandSurfaces,
    },
  };
}

function candidate(
  overrides: Partial<PluginSettingsCandidate> & { id: string },
): PluginSettingsCandidate {
  return {
    app: { hasApp: false, bundle: null },
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
      includeUnloadedSettings: false,
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
      includeUnloadedSettings: false,
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

  it("lists a frontend that loads with its settings page before it has loaded", () => {
    const entries = buildPluginSettingsEntries({
      includeUnloadedSettings: true,
      installedPlugins: [
        candidate({ app: deferredApp(["settings-section"]), id: "keep-awake" }),
        candidate({
          app: deferredApp(["settings-section"]),
          id: "stopped",
          status: "error",
        }),
        candidate({
          app: deferredApp(["settings-section"], false),
          id: "outdated",
        }),
        candidate({
          app: deferredApp(["environment-provider-inputs"]),
          id: "worktree",
        }),
      ],
      settingsSections: [],
    });

    expect(entries.map((entry) => entry.id)).toEqual(["keep-awake"]);
    expect(
      buildPluginSettingsEntries({
        includeUnloadedSettings: false,
        installedPlugins: [
          candidate({
            app: deferredApp(["settings-section"]),
            id: "keep-awake",
          }),
        ],
        settingsSections: [],
      }),
    ).toEqual([]);
  });
});
