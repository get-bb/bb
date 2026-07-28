import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import {
  pluginRowSignal,
  pluginRuntimeStatusPresentation,
} from "./plugin-status";

function plugin(
  updateState: Partial<PluginUpdateState> = {},
  overrides: Partial<PluginListItem> = {},
): PluginListItem {
  return {
    id: "linear",
    source: "npm:@example/linear@^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    name: null,
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "catalog",
    isOrphanedBuiltin: false,
    catalogEntryId: "linear",
    sourceDisplay: "npm · @bb-plugins/linear · tracks compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: false, bundle: null },
    ...overrides,
  };
}

describe("pluginRowSignal (the one-signal rule)", () => {
  it("badges an available compatible update", () => {
    expect(pluginRowSignal(plugin({ availableVersion: "1.7.0" }))).toEqual({
      kind: "update",
      version: "1.7.0",
    });
  });

  it("never badges a newer-but-incompatible release", () => {
    expect(
      pluginRowSignal(
        plugin({
          blockedVersion: "1.9.0",
          blockedReasons: ["requires bb >= 0.15"],
        }),
      ),
    ).toBeNull();
  });

  it("never badges a pinned/quiet plugin", () => {
    expect(pluginRowSignal(plugin())).toBeNull();
  });

  it("names a rolled-back update and lets it outrank an available update", () => {
    expect(
      pluginRowSignal(
        plugin({
          availableVersion: "1.7.0",
          lastFailure: { version: "1.7.0", at: 1, detail: "boom" },
        }),
      ),
    ).toEqual({
      kind: "status",
      icon: "RotateCcw",
      label: "Update failed",
      tone: "error",
      detail: "boom",
    });
  });

  it.each([
    ["error", "CircleX", "Error", "error"],
    ["incompatible", "AlertCircle", "Incompatible", "error"],
    ["missing", "FileQuestion", "Missing", "error"],
    ["needs-configuration", "Settings", "Setup required", "warning"],
    ["degraded", "AlertTriangle", "Degraded", "warning"],
  ] as const)(
    "names the %s runtime status instead of collapsing it into attention",
    (status, icon, label, tone) => {
      expect(
        pluginRowSignal(
          plugin(
            {},
            { status, statusDetail: `${status} detail from the server` },
          ),
        ),
      ).toEqual({
        kind: "status",
        icon,
        label,
        tone,
        detail: `${status} detail from the server`,
      });
    },
  );

  it("provides a useful rollback explanation when the server has no detail", () => {
    expect(
      pluginRowSignal(
        plugin({
          lastFailure: { version: "1.7.0", at: 1, detail: "" },
        }),
      ),
    ).toEqual({
      kind: "status",
      icon: "RotateCcw",
      label: "Update failed",
      tone: "error",
      detail: "Update to 1.7.0 failed and was rolled back.",
    });
  });
});

describe("pluginRuntimeStatusPresentation", () => {
  it("keeps healthy and disabled lifecycle states quiet", () => {
    expect(pluginRuntimeStatusPresentation(plugin())).toBeNull();
    expect(
      pluginRuntimeStatusPresentation(
        plugin({}, { enabled: false, status: "disabled" }),
      ),
    ).toBeNull();
  });

  it("gives local and installed plugin errors appropriate recovery", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin({}, { status: "error", source: "path:/plugins/linear" }),
      ),
    ).toMatchObject({
      label: "Error",
      recovery: "Edit the plugin, then reload it.",
    });
    expect(
      pluginRuntimeStatusPresentation(plugin({}, { status: "error" })),
    ).toMatchObject({
      label: "Error",
      recovery: "Reload the plugin. If the error continues, reinstall it.",
    });
  });

  it("explains that saved settings automatically retry configuration", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin({}, { status: "needs-configuration", hasSettings: true }),
      ),
    ).toMatchObject({
      label: "Setup required",
      recovery:
        "Complete the Settings section; bb reloads the plugin after you save.",
    });
  });
});
