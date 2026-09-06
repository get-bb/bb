// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import { pluginListQueryKey } from "./queries/query-keys";
import { markEnabledPluginListStale } from "./cache-owners/plugin-cache-owner";
import {
  createPluginFrontendReconcileState,
  fetchFrontendCandidates,
  reconcilePluginFrontends,
  type PluginFrontendReconcileDeps,
} from "@/lib/plugin-frontend";
import { definePluginApp } from "@/lib/plugin-app-definition";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";

const scheduled = vi.hoisted(() => ({ run: () => {} }));
vi.mock("@/lib/plugin-frontend-lazy", () => ({
  schedulePluginFrontendReconcile: () => scheduled.run(),
}));

afterEach(() => {
  scheduled.run = () => {};
  vi.unstubAllGlobals();
});

it.each(["initial connect", "reconnect", "reload notification"])(
  "loads plugins after a missed startup notification on %s",
  async (trigger) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const plugins = ["first", "second"].map((id) =>
      makeInstalledPlugin({
        id,
        app: {
          hasApp: true,
          bundle: {
            jsUrl: `/plugins/${id}.js`,
            cssUrl: null,
            jsBytes: 100,
            hash: id,
            sdkMajor: 0,
            sdkVersion: "0.1.0",
            compatible: true,
          },
        },
      }),
    );
    queryClient.setQueryData(
      pluginListQueryKey(true),
      plugins.map((plugin) => ({
        ...plugin,
        status: "error",
        statusDetail: "not loaded",
      })),
    );
    const fetch = vi.fn(async () => Response.json({ plugins }));
    vi.stubGlobal("fetch", fetch);
    const state = createPluginFrontendReconcileState();
    const register = vi.fn();
    const deps: PluginFrontendReconcileDeps = {
      fetchCandidates: () => fetchFrontendCandidates(queryClient),
      importModule: async () => ({ default: definePluginApp(() => {}) }),
      applyCss: () => {},
      retainCss: () => () => {},
      resetCrashedSlots: () => {},
      setRegistrations: register,
      removeRegistrations: () => {},
      beginSlotBatch: () => () => {},
      warn: () => {},
      routePluginId: () => null,
    };
    const effects = createRealtimeCacheEffects({ queryClient });
    let reconcile = Promise.resolve();
    scheduled.run = () => {
      reconcile = markEnabledPluginListStale({ queryClient }).then(() =>
        reconcilePluginFrontends(state, deps),
      );
    };
    try {
      await reconcilePluginFrontends(state, deps);
      expect(register).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      if (trigger === "reload notification") {
        effects.handleChanged({
          type: "changed",
          entity: "system",
          changes: ["plugins-changed"],
        });
      } else {
        effects.handleConnected(
          trigger === "reconnect"
            ? { reconnected: true, disconnectedAt: Date.now() }
            : { reconnected: false },
        );
      }
      await reconcile;
      expect([...state.activeGenerations.keys()].sort()).toEqual([
        "first",
        "second",
      ]);
      expect(register).toHaveBeenCalledTimes(2);
    } finally {
      effects.dispose();
      queryClient.clear();
    }
  },
);
