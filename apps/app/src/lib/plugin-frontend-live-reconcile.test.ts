import { describe, expect, it, vi } from "vitest";
import { definePluginApp } from "./plugin-app-definition";
import {
  createPluginFrontendReconcileState,
  reconcilePluginFrontends,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "./plugin-frontend";

function candidate(pluginId: string, hash: string): PluginFrontendCandidate {
  return {
    pluginId,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=${hash}`,
      cssUrl: null,
      jsBytes: 1_000,
      hash,
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
      runtimeSlots: [],
    },
  };
}

function deps(
  candidates: () => PluginFrontendCandidate[],
): PluginFrontendReconcileDeps {
  return {
    fetchCandidates: async () => candidates(),
    importModule: async () => ({ default: definePluginApp(() => {}) }),
    importRetryDelaysMs: [],
    applyCss: () => {},
    prefetchCss: () => {},
    prefetchModule: () => {},
    retainCss: () => () => {},
    resetCrashedSlots: () => {},
    setRegistrations: () => {},
    removeRegistrations: () => {},
    beginSlotBatch: () => () => {},
    flushSlotBatch: () => {},
    warn: () => {},
    priorityPluginIds: () => [],
  };
}

describe("live plugin frontend reconcile", () => {
  it("reports pending work only when a plugin frontend loads, changes or leaves", async () => {
    const state = createPluginFrontendReconcileState();
    let current = [candidate("first", "a"), candidate("second", "a")];
    const reconcileDeps = deps(() => current);
    const onChanges = vi.fn();

    await reconcilePluginFrontends(state, reconcileDeps, onChanges);
    expect(onChanges).toHaveBeenCalledTimes(1);

    onChanges.mockClear();
    await reconcilePluginFrontends(state, reconcileDeps, onChanges);
    expect(onChanges).not.toHaveBeenCalled();

    current = [candidate("first", "b"), candidate("second", "a")];
    await reconcilePluginFrontends(state, reconcileDeps, onChanges);
    expect(onChanges).toHaveBeenCalledTimes(1);

    onChanges.mockClear();
    current = [candidate("first", "b")];
    await reconcilePluginFrontends(state, reconcileDeps, onChanges);
    expect(onChanges).toHaveBeenCalledTimes(1);
  });
});
