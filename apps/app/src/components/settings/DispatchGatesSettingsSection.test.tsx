// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DispatchGateStage } from "@bb/domain";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  nextDispatchGateOrder,
  orderStageGatePlugins,
  reorderGatePluginIds,
} from "./DispatchGatesSettingsSection";

function plugin(
  id: string,
  dispatchGateStages: DispatchGateStage[],
): PluginListItem {
  return {
    id,
    rootDir: `/plugins/${id}`,
    version: "1.0.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    name: id.toUpperCase(),
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
    dispatchGateStages,
    app: { hasApp: false, bundle: null },
    provenance: "direct",
    source: `npm:${id}`,
    isOrphanedBuiltin: false,
    catalogEntryId: null,
    publisherLabel: null,
    sourceDisplay: id,
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
  };
}

// Install order is the order the plugin list arrives in, which is the order
// the server's gate registry iterates.
const INSTALLED = [
  plugin("alpha", ["dispatch", "turn.failed"]),
  plugin("beta", ["dispatch"]),
  plugin("gamma", ["turn.failed"]),
  plugin("delta", []),
];

describe("orderStageGatePlugins", () => {
  it("keeps install order for the stage's gates when nothing is pinned", () => {
    expect(
      orderStageGatePlugins(INSTALLED, "dispatch", []).map((p) => p.id),
    ).toEqual(["alpha", "beta"]);
    expect(
      orderStageGatePlugins(INSTALLED, "turn.failed", []).map((p) => p.id),
    ).toEqual(["alpha", "gamma"]);
  });

  it("leads with pinned ids and keeps the rest in install order", () => {
    const installed = [
      ...INSTALLED,
      plugin("epsilon", ["dispatch"]),
      plugin("zeta", ["dispatch"]),
    ];
    expect(
      orderStageGatePlugins(installed, "dispatch", ["zeta"]).map(
        (p) => p.id,
      ),
    ).toEqual(["zeta", "alpha", "beta", "epsilon"]);
  });

  it("ignores a pinned id that registers no gate for the stage", () => {
    // `gamma` gates turn.failed only and `delta` gates nothing; neither may
    // conjure a row into dispatch, and neither may shift the real chain.
    expect(
      orderStageGatePlugins(INSTALLED, "dispatch", [
        "gamma",
        "delta",
        "beta",
      ]).map((p) => p.id),
    ).toEqual(["beta", "alpha"]);
  });
});

describe("reorder to settings mapping", () => {
  it("writes only the dragged stage and leaves the others untouched", () => {
    const current = {
      "turn.failed": ["gamma", "alpha"],
    } satisfies Record<string, string[]>;
    const ids = orderStageGatePlugins(INSTALLED, "dispatch", []).map(
      (p) => p.id,
    );
    const dragged = reorderGatePluginIds(ids, "beta", "alpha");
    expect(dragged).toEqual(["beta", "alpha"]);

    const next = nextDispatchGateOrder(current, "dispatch", dragged ?? []);
    expect(next).toEqual({
      "turn.failed": ["gamma", "alpha"],
      "dispatch": ["beta", "alpha"],
    });
    // The setting is replaced, not mutated: a failed write must leave the
    // previous object intact for the optimistic rollback.
    expect(current).toEqual({ "turn.failed": ["gamma", "alpha"] });
  });

  it("reports no change when a row is dropped on itself", () => {
    expect(reorderGatePluginIds(["alpha", "beta"], "beta", "beta")).toBeNull();
    expect(reorderGatePluginIds(["alpha", "beta"], "beta", "ghost")).toBeNull();
  });
});
