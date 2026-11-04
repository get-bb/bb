import { describe, expect, it, vi } from "vitest";
import type { PluginAppOnDemandSurface } from "@bb/domain";
import { definePluginApp } from "./plugin-app-definition";
import {
  createPluginFrontendReconcileState,
  orderPluginFrontendCandidates,
  reconcilePluginFrontends,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "./plugin-frontend";

function candidate(
  pluginId: string,
  jsBytes: number,
  onDemandSurfaces: PluginAppOnDemandSurface[] = [],
): PluginFrontendCandidate {
  return {
    pluginId,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=h`,
      cssUrl: `/api/v1/plugins/${pluginId}/assets/app.css?h=h`,
      jsBytes,
      hash: "h",
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
      runtimeSlots: [],
      onDemandSurfaces,
    },
  };
}

function pluginModule(): Record<string, unknown> {
  return { default: definePluginApp(() => {}) };
}

function makeDeferredImports() {
  const started: string[] = [];
  const resolvers = new Map<string, () => void>();
  const importModule = vi.fn((url: string): Promise<unknown> => {
    started.push(url);
    return new Promise((resolve) => {
      resolvers.set(url, () => resolve(pluginModule()));
    });
  });
  return {
    importModule,
    started,
    pending: () => resolvers.size,
    resolveNext: async () => {
      const [url, resolve] = [...resolvers][0]!;
      resolvers.delete(url);
      resolve();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
  };
}

function makeDeps(
  candidates: PluginFrontendCandidate[],
  overrides: Partial<PluginFrontendReconcileDeps> = {},
): PluginFrontendReconcileDeps {
  return {
    fetchCandidates: async () => candidates,
    importModule: async () => pluginModule(),
    importRetryDelaysMs: [],
    applyCss: vi.fn(),
    prefetchCss: vi.fn(),
    prefetchModule: vi.fn(),
    retainCss: vi.fn(() => vi.fn()),
    resetCrashedSlots: vi.fn(),
    setRegistrations: vi.fn(),
    removeRegistrations: vi.fn(),
    warn: vi.fn(),
    priorityPluginIds: () => [],
    isSurfaceDemanded: () => false,
    whenPageSettled: async () => {},
    beginSlotBatch: () => () => {},
    flushSlotBatch: () => {},
    ...overrides,
  };
}

describe("orderPluginFrontendCandidates", () => {
  it("puts priority plugins first in priority order, then ascending bundle size", () => {
    const ordered = orderPluginFrontendCandidates(
      [
        candidate("automations", 1_060_000),
        candidate("secrets", 644_000),
        candidate("keep-awake", 309_000),
        candidate("side-chat", 242_000),
      ],
      ["secrets", "uninstalled", "automations"],
    );
    expect(ordered.map((c) => c.pluginId)).toEqual([
      "secrets",
      "automations",
      "side-chat",
      "keep-awake",
    ]);
  });

  it("keeps inventory order for equal sizes and does not mutate the input", () => {
    const input = [candidate("b", 10), candidate("a", 10), candidate("c", 5)];
    const ordered = orderPluginFrontendCandidates(input, []);
    expect(ordered.map((c) => c.pluginId)).toEqual(["c", "b", "a"]);
    expect(input.map((c) => c.pluginId)).toEqual(["b", "a", "c"]);
  });
});

describe("reconcilePluginFrontends load scheduling", () => {
  it("imports priority plugins first, then every other bundle at once after the page settles", async () => {
    const imports = makeDeferredImports();
    let settle = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(
      [
        candidate("big", 900),
        candidate("mid", 500),
        candidate("small", 100),
        candidate("tiny", 10),
        candidate("panel", 700),
        candidate("thread-list", 800),
      ],
      {
        importModule: imports.importModule,
        priorityPluginIds: () => ["panel", "thread-list"],
        whenPageSettled: () => settled,
      },
    );
    const done = reconcilePluginFrontends(state, deps);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(imports.started).toEqual([
      "/api/v1/plugins/panel/assets/app.js?h=h",
      "/api/v1/plugins/thread-list/assets/app.js?h=h",
    ]);

    await imports.resolveNext();
    await imports.resolveNext();
    expect(imports.started).toHaveLength(2);

    settle();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(imports.started.slice(2)).toEqual([
      "/api/v1/plugins/tiny/assets/app.js?h=h",
      "/api/v1/plugins/small/assets/app.js?h=h",
      "/api/v1/plugins/mid/assets/app.js?h=h",
      "/api/v1/plugins/big/assets/app.js?h=h",
    ]);

    while (imports.pending() > 0) await imports.resolveNext();
    await done;
    expect([...state.records.keys()].sort()).toEqual([
      "big",
      "mid",
      "panel",
      "small",
      "thread-list",
      "tiny",
    ]);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(6);
  });

  it("publishes priority plugins while the remaining imports are still pending", async () => {
    const imports = makeDeferredImports();
    const events: string[] = [];
    const done = reconcilePluginFrontends(
      createPluginFrontendReconcileState(),
      makeDeps(
        [
          candidate("small", 10),
          candidate("thread-list", 900),
          candidate("big", 800),
        ],
        {
          importModule: imports.importModule,
          priorityPluginIds: () => ["thread-list", "not-installed"],
          setRegistrations: (pluginId) => events.push(`register ${pluginId}`),
          beginSlotBatch: () => {
            events.push("open batch");
            return () => events.push("close batch");
          },
        },
      ),
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(events).toEqual(["open batch"]);

    await imports.resolveNext();
    expect(events).toEqual([
      "open batch",
      "register thread-list",
      "close batch",
      "open batch",
    ]);
    expect(imports.started).toHaveLength(3);

    await imports.resolveNext();
    await imports.resolveNext();
    await done;
    expect(events.slice(4)).toEqual([
      "register small",
      "register big",
      "close batch",
    ]);
  });

  it("leaves on-demand frontends unloaded until one of their surfaces is demanded", async () => {
    const demanded = new Set<PluginAppOnDemandSurface>();
    const importModule = vi.fn(async () => pluginModule());
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(
      [
        candidate("eager", 1),
        candidate("keep-awake", 2, ["settings-section"]),
        candidate("worktree", 3, ["environment-provider-inputs"]),
      ],
      {
        importModule,
        isSurfaceDemanded: (surface) => demanded.has(surface),
      },
    );

    await reconcilePluginFrontends(state, deps);
    expect([...state.records.keys()]).toEqual(["eager"]);

    demanded.add("settings-section");
    await reconcilePluginFrontends(state, deps);
    expect([...state.records.keys()].sort()).toEqual(["eager", "keep-awake"]);
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it("loads an on-demand frontend the current route needs without a demand", async () => {
    const state = createPluginFrontendReconcileState();
    await reconcilePluginFrontends(
      state,
      makeDeps([candidate("keep-awake", 2, ["settings-section"])], {
        priorityPluginIds: () => ["keep-awake"],
      }),
    );
    expect(state.records.get("keep-awake")?.status).toBe("loaded");
  });

  it("keeps a loaded on-demand frontend and reloads it when its bundle changes", async () => {
    let demanded = true;
    let hash = "h1";
    const importModule = vi.fn(async () => pluginModule());
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps([], {
      fetchCandidates: async () => [
        {
          pluginId: "keep-awake",
          bundle: {
            ...candidate("keep-awake", 2, ["settings-section"]).bundle,
            hash,
          },
        },
      ],
      importModule,
      isSurfaceDemanded: () => demanded,
    });

    await reconcilePluginFrontends(state, deps);
    demanded = false;
    hash = "h2";
    await reconcilePluginFrontends(state, deps);

    expect(importModule).toHaveBeenCalledTimes(2);
    expect(state.appliedHashes.get("keep-awake")).toBe("h2");
    expect(deps.removeRegistrations).not.toHaveBeenCalled();
  });

  it("a rejected import in one lane does not stall the remaining candidates", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(
      [candidate("broken", 1), candidate("fine", 2), candidate("also", 3)],
      {
        importModule: async (url) => {
          if (url.includes("/broken/")) throw new Error("boom");
          return pluginModule();
        },
      },
    );
    await reconcilePluginFrontends(state, deps);
    expect(state.records.get("broken")?.status).toBe("failed");
    expect(state.records.get("fine")?.status).toBe("loaded");
    expect(state.records.get("also")?.status).toBe("loaded");
  });
});
