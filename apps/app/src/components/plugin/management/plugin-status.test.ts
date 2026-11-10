import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import {
  pluginRowSignals,
  pluginRuntimeStatusPresentation,
} from "./plugin-status";
import { makePluginListItem } from "@/test/fixtures/plugins";

function plugin(
  updateState: Partial<PluginUpdateState> = {},
  overrides: Partial<PluginListItem> = {},
): PluginListItem {
  return makePluginListItem({
    id: "linear",
    source: "npm:@example/linear@^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    name: null,
    provenance: "catalog",
    catalogEntryId: "linear",
    publisherLabel: "BB Community",
    sourceDisplay: "npm · @bb-plugins/linear · tracks compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
    ...overrides,
  });
}

describe("pluginRowSignals", () => {
  it("badges an available compatible update", () => {
    expect(
      pluginRowSignals(
        plugin({ availableVersion: "1.7.0", availableLabel: "1.7.0" }),
      ),
    ).toEqual({ status: null, update: { kind: "update", version: "1.7.0" } });
  });

  it("never badges a newer-but-incompatible release", () => {
    expect(
      pluginRowSignals(
        plugin({
          blockedVersion: "1.9.0",
          blockedLabel: "1.9.0",
          blockedReasons: ["requires bb >= 0.15"],
        }),
      ),
    ).toEqual({ status: null, update: null });
  });

  it("never badges a pinned/quiet plugin", () => {
    expect(pluginRowSignals(plugin())).toEqual({ status: null, update: null });
  });

  it("surfaces an update-source security refusal", () => {
    expect(
      pluginRowSignals(
        plugin({
          outcome: "unavailable",
          detail:
            "The cached checkout does not prove that this ref was a branch.",
        }),
      ),
    ).toEqual({
      status: {
        kind: "status",
        icon: "AlertTriangle",
        label: "Needs attention",
        tone: "warning",
        detail:
          "The cached checkout does not prove that this ref was a branch.",
      },
      update: null,
    });
  });

  it("names a rolled-back update and lets it outrank an available update", () => {
    expect(
      pluginRowSignals(
        plugin({
          availableVersion: "1.7.0",
          availableLabel: "1.7.0",
          lastFailure: {
            version: "1.7.0",
            label: "1.7.0",
            at: 1,
            detail: "boom",
          },
        }),
      ),
    ).toEqual({
      status: {
        kind: "status",
        icon: "RotateCcw",
        label: "Update failed",
        tone: "error",
        detail: "boom",
      },
      update: null,
    });
  });

  it.each([
    ["error", "CircleX", "Failed", "error"],
    ["incompatible", "AlertCircle", "Incompatible", "error"],
    ["missing", "FileQuestion", "Missing", "error"],
    ["needs-configuration", "Settings", "Needs configuration", "warning"],
    ["degraded", "AlertTriangle", "Degraded", "warning"],
  ] as const)(
    "names the %s runtime status instead of collapsing it into attention",
    (status, icon, label, tone) => {
      expect(
        pluginRowSignals(
          plugin(
            {},
            { status, statusDetail: `${status} detail from the server` },
          ),
        ),
      ).toEqual({
        status: {
          kind: "status",
          icon,
          label,
          tone,
          detail: `${status} detail from the server`,
        },
        update: null,
      });
    },
  );

  it("badges a reviewable release outside the range next to an earlier failure", () => {
    expect(
      pluginRowSignals(
        plugin({
          lastFailure: { version: "2.0.0", label: "2.0.0", at: 1, detail: "" },
          rangeUpgrade: {
            currentRange: "^1.6.0",
            range: "^2.0.0",
            basis: "catalog",
            candidate: { version: "2.1.0", label: "2.1.0", display: "2.1.0" },
            breaking: true,
            reasons: [],
          },
        }),
      ),
    ).toMatchObject({
      status: { kind: "status", label: "Update failed" },
      update: { kind: "update", version: "2.1.0" },
    });
  });

  it("provides a useful rollback explanation when the server has no detail", () => {
    expect(
      pluginRowSignals(
        plugin({
          lastFailure: { version: "1.7.0", label: "1.7.0", at: 1, detail: "" },
        }),
      ),
    ).toEqual({
      status: {
        kind: "status",
        icon: "RotateCcw",
        label: "Update failed",
        tone: "error",
        detail: "Update to 1.7.0 failed and was rolled back.",
      },
      update: null,
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
      label: "Failed",
      condition: "The plugin couldn't start.",
      recovery: "Fix the plugin, then reload.",
    });
    expect(
      pluginRuntimeStatusPresentation(plugin({}, { status: "error" })),
    ).toMatchObject({
      label: "Failed",
      condition: "The plugin couldn't start.",
      recovery: "Try reloading it.",
    });
  });

  it("gives missing bundled and installed plugins source-appropriate recovery", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin(
          {},
          {
            status: "missing",
            provenance: "builtin",
            source: "builtin:linear",
          },
        ),
      ),
    ).toMatchObject({
      recovery: "Update or reinstall bb.",
    });
    expect(
      pluginRuntimeStatusPresentation(plugin({}, { status: "missing" })),
    ).toMatchObject({
      recovery: "Reinstall from its source.",
    });
  });

  it("explains that saved settings automatically retry configuration", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin({}, { status: "needs-configuration", hasSettings: true }),
      ),
    ).toMatchObject({
      label: "Needs configuration",
      condition: "Complete the required settings.",
      recovery: "",
    });
  });
  it("recovers missing local files without deleting the installation", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin(
          {},
          {
            status: "missing",
            source: "path:/plugins/linear",
          },
        ),
      ),
    ).toMatchObject({ recovery: "Restore the folder, then reload." });
  });

  it("directs configured path failures to the path instead of reinstalling", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin(
          {},
          {
            status: "error",
            statusDetail:
              "Configured directory /workspace/traces does not exist",
          },
        ),
      ),
    ).toMatchObject({
      condition: "Configured folder unavailable.",
      recovery: "Check the path, then reload.",
    });
  });

  it("keeps a running instance quiet after reload failure or a service restart", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin(
          {},
          {
            status: "running",
            statusDetail: "Reload failed; previous instance retained",
          },
        ),
      ),
    ).toBeNull();
    expect(
      pluginRuntimeStatusPresentation(
        plugin(
          {},
          {
            status: "running",
            services: [
              {
                name: "sync",
                state: "backoff",
              },
            ],
          },
        ),
      ),
    ).toBeNull();
  });
});
