import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import {
  pluginRowSignal,
  pluginToastSignal,
} from "./plugin-update-signals";

function plugin(
  updateState: Partial<PluginUpdateState> = {},
  overrides: Partial<PluginListItem> = {},
): PluginListItem {
  return {
    id: "linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    displayName: null,
    icon: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "marketplace",
    marketplaceName: "bb-official",
    sourceDisplay: "npm · @bb-plugins/linear · tracking ^1.4.0",
    updatePolicy: "compatible",
    autoApply: null,
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

  it("stays quiet when the available version was ignored", () => {
    expect(
      pluginRowSignal(
        plugin({ availableVersion: "1.7.0", ignoredVersion: "1.7.0" }),
      ),
    ).toBeNull();
  });

  it("badges again when a newer version supersedes the ignored one", () => {
    expect(
      pluginRowSignal(
        plugin({ availableVersion: "1.8.0", ignoredVersion: "1.7.0" }),
      ),
    ).toEqual({ kind: "update", version: "1.8.0" });
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

describe("pluginToastSignal (notification rules)", () => {
  it("toasts a compatible update", () => {
    const signal = pluginToastSignal(plugin({ availableVersion: "1.7.0" }));
    expect(signal?.kind).toBe("update-available");
    expect(signal?.version).toBe("1.7.0");
  });

  it("never toasts an incompatible newer release", () => {
    expect(
      pluginToastSignal(plugin({ blockedVersion: "1.9.0" })),
    ).toBeNull();
  });

  it("never toasts an ignored version", () => {
    expect(
      pluginToastSignal(
        plugin({ availableVersion: "1.7.0", ignoredVersion: "1.7.0" }),
      ),
    ).toBeNull();
  });

  it("toasts a rollback with its detail", () => {
    const signal = pluginToastSignal(
      plugin({
        lastFailure: { version: "1.3.0", at: 5, detail: "failed to start" },
      }),
    );
    expect(signal).toEqual({
      kind: "rolled-back",
      key: "linear:failure:1.3.0:5",
      version: "1.3.0",
      detail: "failed to start",
    });
  });

  it("keys re-failure of the same version by timestamp so it re-notifies", () => {
    const first = pluginToastSignal(
      plugin({ lastFailure: { version: "1.3.0", at: 5, detail: null } }),
    );
    const second = pluginToastSignal(
      plugin({ lastFailure: { version: "1.3.0", at: 9, detail: null } }),
    );
    expect(first?.key).not.toBe(second?.key);
  });
});
