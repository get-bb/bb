import { describe, expect, it, vi } from "vitest";
import { definePluginApp } from "./plugin-app-definition";
import {
  createPluginFrontendReconcileState,
  orderPluginFrontendCandidates,
  reconcilePluginFrontends,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "./plugin-frontend";

function candidate(pluginId: string, jsBytes: number): PluginFrontendCandidate {
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
    beginSlotBatch: () => () => {},
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
  it("imports at most PLUGIN_FRONTEND_LOAD_CONCURRENCY bundles at once, in priority order", async () => {
    const imports = makeDeferredImports();
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(
      [
        candidate("big", 900),
        candidate("mid", 500),
        candidate("small", 100),
        candidate("tiny", 10),
        candidate("panel", 700),
      ],
      {
        importModule: imports.importModule,
        priorityPluginIds: () => ["panel"],
      },
    );
    const done = reconcilePluginFrontends(state, deps);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(imports.started).toEqual([
      "/api/v1/plugins/panel/assets/app.js?h=h",
      "/api/v1/plugins/tiny/assets/app.js?h=h",
      "/api/v1/plugins/small/assets/app.js?h=h",
    ]);

    await imports.resolveNext();
    expect(imports.started).toHaveLength(4);
    expect(imports.started[3]).toBe("/api/v1/plugins/mid/assets/app.js?h=h");

    await imports.resolveNext();
    expect(imports.started).toHaveLength(5);
    expect(imports.started[4]).toBe("/api/v1/plugins/big/assets/app.js?h=h");

    await imports.resolveNext();
    await imports.resolveNext();
    await imports.resolveNext();
    await done;
    expect([...state.records.keys()].sort()).toEqual([
      "big",
      "mid",
      "panel",
      "small",
      "tiny",
    ]);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(5);
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

  it("downloads the next bundles ahead of the import lanes once priority plugins load", async () => {
    const imports = makeDeferredImports();
    const prefetchModule = vi.fn();
    const done = reconcilePluginFrontends(
      createPluginFrontendReconcileState(),
      makeDeps(
        [
          candidate("thread-list", 900),
          candidate("a", 10),
          candidate("b", 20),
          candidate("c", 30),
          candidate("d", 40),
          candidate("e", 50),
          candidate("f", 60),
        ],
        {
          importModule: imports.importModule,
          priorityPluginIds: () => ["thread-list"],
          prefetchModule,
        },
      ),
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(prefetchModule).not.toHaveBeenCalled();

    await imports.resolveNext();
    const prefetchedIds = () =>
      prefetchModule.mock.calls.map(([url]) => String(url).split("/")[4]);
    expect(prefetchedIds()).toEqual(["d", "e", "f"]);

    while (imports.started.length < 7 || imports.pending() > 0) {
      await imports.resolveNext();
    }
    await done;
    expect(prefetchedIds()).toEqual(["d", "e", "f"]);
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
