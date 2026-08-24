// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { definePluginApp } from "./plugin-app-definition";
import {
  createPluginFrontendReconcileState,
  reconcilePluginFrontends,
  selectLoadablePluginFrontendCandidates,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "./plugin-frontend";
import {
  getWantedProviderPluginIds,
  markProviderPluginFrontendWanted,
  resetProviderPluginFrontendGateForTest,
} from "./plugin-frontend-provider-gate";

function candidate(
  pluginId: string,
  providerIds: readonly string[] = [],
): PluginFrontendCandidate {
  return {
    pluginId,
    providerIds,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=h`,
      cssUrl: null,
      jsBytes: 100,
      hash: "h",
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
    },
  };
}

function pluginModule(): Record<string, unknown> {
  return { default: definePluginApp(() => {}) };
}

function makeDeps(
  candidates: PluginFrontendCandidate[],
  importModule: PluginFrontendReconcileDeps["importModule"],
): PluginFrontendReconcileDeps {
  return {
    fetchCandidates: async () => candidates,
    importModule,
    applyCss: vi.fn(),
    retainCss: vi.fn(() => vi.fn()),
    resetCrashedSlots: vi.fn(),
    setRegistrations: vi.fn(),
    removeRegistrations: vi.fn(),
    warn: vi.fn(),
    routePluginId: () => null,
    wantedProviderPluginIds: getWantedProviderPluginIds,
    beginSlotBatch: () => () => {},
  };
}

afterEach(() => {
  resetProviderPluginFrontendGateForTest();
});

/**
 * Q30 (docs/provider-plugin-api.md §5): a provider plugin's frontend bundle
 * loads on the first thread of that provider and never at boot.
 */
describe("provider plugin frontends load lazily", () => {
  it("selects every non-provider plugin and only the wanted provider plugins", () => {
    const candidates = [
      candidate("github"),
      candidate("provider-codex", ["codex"]),
      candidate("echo-provider", ["echo-agent"]),
    ];
    expect(
      selectLoadablePluginFrontendCandidates(candidates, new Set()).map(
        (c) => c.pluginId,
      ),
    ).toEqual(["github"]);
    expect(
      selectLoadablePluginFrontendCandidates(
        candidates,
        new Set(["echo-provider"]),
      ).map((c) => c.pluginId),
    ).toEqual(["github", "echo-provider"]);
  });

  it("fetches zero provider bundles before a thread of that provider opens", async () => {
    const imported: string[] = [];
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(
      [
        candidate("github"),
        candidate("echo-provider", ["echo-agent"]),
        candidate("provider-codex", ["codex"]),
      ],
      async (url) => {
        imported.push(url);
        return pluginModule();
      },
    );

    // Boot: only the non-provider plugin's bundle is imported.
    await reconcilePluginFrontends(state, deps);
    expect(imported).toEqual(["/api/v1/plugins/github/assets/app.js?h=h"]);
    expect([...state.records.keys()]).toEqual(["github"]);

    // A second pass with nothing wanted is still provider-free and must not
    // treat the deferred plugins as gone (no removal, no import).
    await reconcilePluginFrontends(state, deps);
    expect(imported).toHaveLength(1);
    expect(deps.removeRegistrations).not.toHaveBeenCalled();

    // The first echo-agent thread opens: exactly that plugin's bundle loads.
    expect(markProviderPluginFrontendWanted("echo-provider")).toBe(true);
    expect(markProviderPluginFrontendWanted("echo-provider")).toBe(false);
    await reconcilePluginFrontends(state, deps);
    expect(imported).toEqual([
      "/api/v1/plugins/github/assets/app.js?h=h",
      "/api/v1/plugins/echo-provider/assets/app.js?h=h",
    ]);
    expect(state.records.get("echo-provider")?.status).toBe("loaded");
    expect(state.records.has("provider-codex")).toBe(false);
  });
});
