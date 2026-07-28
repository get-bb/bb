import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginRowSignal } from "./plugin-update-signals";

function plugin(
  updateState: Partial<PluginUpdateState> = {},
  overrides: Partial<PluginListItem> = {},
): PluginListItem {
  return {
    id: "linear",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    name: null,
    source: "npm:@example/linear@^1.6.0",
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: false, bundle: null },
    provenance: "catalog",
    isOrphanedBuiltin: false,
    catalogEntryId: "linear",
    sourceDisplay: "npm · @bb-plugins/linear · tracks compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
    ...overrides,
  };
}

describe("pluginRowSignal (the one-pill rule)", () => {
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

  it("shows Needs attention after a rolled-back update, outranking an update", () => {
    expect(
      pluginRowSignal(
        plugin({
          availableVersion: "1.7.0",
          lastFailure: { version: "1.7.0", at: 1, detail: "boom" },
        }),
      ),
    ).toEqual({ kind: "attention" });
  });

  it("shows Needs attention for a plugin that failed to load", () => {
    expect(pluginRowSignal(plugin({}, { status: "error" }))).toEqual({
      kind: "attention",
    });
  });
});
