// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { definePluginApp } from "./plugin-app-definition";
import {
  createPluginFrontendReconcileState,
  orderPluginFrontendCandidates,
  PLUGIN_FRONTEND_LOAD_CONCURRENCY,
  reconcileFullPluginFrontendBoot,
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
    applyCss: vi.fn(),
    retainCss: vi.fn(() => vi.fn()),
    resetCrashedSlots: vi.fn(),
    setRegistrations: vi.fn(),
    removeRegistrations: vi.fn(),
    warn: vi.fn(),
    routePluginId: () => null,
    beginSlotBatch: () => () => {},
    ...overrides,
  };
}

describe("orderPluginFrontendCandidates", () => {
  it("puts the route-owning plugin first, then ascending bundle size", () => {
    const ordered = orderPluginFrontendCandidates(
      [
        candidate("automations", 1_060_000),
        candidate("secrets", 644_000),
        candidate("keep-awake", 309_000),
        candidate("side-chat", 242_000),
      ],
      "secrets",
    );
    expect(ordered.map((c) => c.pluginId)).toEqual([
      "secrets",
      "side-chat",
      "keep-awake",
      "automations",
    ]);
  });

  it("puts remembered first-screen owners after the route plugin and before smaller bundles", () => {
    const ordered = orderPluginFrontendCandidates(
      [
        candidate("automations", 1_060_000),
        candidate("thread-list", 406_000),
        candidate("pdf-preview", 6_900),
        candidate("navigation", 95_800),
        candidate("secrets", 644_000),
      ],
      "secrets",
      new Set(["thread-list", "navigation"]),
    );
    expect(ordered.map((c) => c.pluginId)).toEqual([
      "secrets",
      "navigation",
      "thread-list",
      "pdf-preview",
      "automations",
    ]);
  });

  it("keeps inventory order for equal sizes and does not mutate the input", () => {
    const input = [candidate("b", 10), candidate("a", 10), candidate("c", 5)];
    const ordered = orderPluginFrontendCandidates(input, null);
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
        candidate("a", 20),
        candidate("b", 30),
        candidate("c", 40),
        candidate("panel", 700),
      ],
      { importModule: imports.importModule, routePluginId: () => "panel" },
    );
    const done = reconcilePluginFrontends(state, deps);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(PLUGIN_FRONTEND_LOAD_CONCURRENCY).toBe(6);
    expect(imports.started).toEqual([
      "/api/v1/plugins/panel/assets/app.js?h=h",
      "/api/v1/plugins/tiny/assets/app.js?h=h",
      "/api/v1/plugins/a/assets/app.js?h=h",
      "/api/v1/plugins/b/assets/app.js?h=h",
      "/api/v1/plugins/c/assets/app.js?h=h",
      "/api/v1/plugins/small/assets/app.js?h=h",
    ]);

    await imports.resolveNext();
    expect(imports.started).toHaveLength(7);
    expect(imports.started[6]).toBe("/api/v1/plugins/mid/assets/app.js?h=h");

    await imports.resolveNext();
    expect(imports.started).toHaveLength(8);
    expect(imports.started[7]).toBe("/api/v1/plugins/big/assets/app.js?h=h");

    for (let i = 0; i < 6; i += 1) await imports.resolveNext();
    await done;
    expect([...state.records.keys()].sort()).toEqual([
      "a",
      "b",
      "big",
      "c",
      "mid",
      "panel",
      "small",
      "tiny",
    ]);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(8);
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

describe("reconcilePluginFrontends phases", () => {
  const firstScreenPluginIds = new Set(["thread-list", "navigation"]);
  const candidates = () => [
    candidate("pdf-preview", 10),
    candidate("thread-list", 900),
    candidate("navigation", 100),
    candidate("secrets", 500),
  ];

  function importedPluginIds(importModule: ReturnType<typeof vi.fn>) {
    return importModule.mock.calls.map(([url]) => String(url).split("/")[4]);
  }

  it("the first-screen phase loads only the remembered owners that are still installed", async () => {
    const importModule = vi.fn(async () => pluginModule());
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(candidates(), { importModule });

    await reconcilePluginFrontends(state, deps, {
      phase: "first-screen",
      firstScreenPluginIds: new Set([...firstScreenPluginIds, "removed"]),
    });

    expect(importedPluginIds(importModule)).toEqual([
      "navigation",
      "thread-list",
    ]);
    expect([...state.records.keys()].sort()).toEqual([
      "navigation",
      "thread-list",
    ]);
  });

  it("the rest phase loads everything else while the first-screen phase is still importing", async () => {
    const imports = makeDeferredImports();
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(candidates(), { importModule: imports.importModule });

    const firstScreen = reconcilePluginFrontends(state, deps, {
      phase: "first-screen",
      firstScreenPluginIds,
    });
    const rest = reconcilePluginFrontends(state, deps, {
      phase: "rest",
      firstScreenPluginIds,
    });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(imports.started.map((url) => url.split("/")[4])).toEqual([
      "navigation",
      "thread-list",
      "pdf-preview",
      "secrets",
    ]);
    for (let i = 0; i < 4; i += 1) await imports.resolveNext();
    await Promise.all([firstScreen, rest]);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(4);
  });

  it("a later full reconcile skips first-screen plugins already applied at the same hash", async () => {
    const importModule = vi.fn(async () => pluginModule());
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(candidates(), { importModule });

    await reconcilePluginFrontends(state, deps, {
      phase: "first-screen",
      firstScreenPluginIds,
    });
    importModule.mockClear();
    await reconcilePluginFrontends(state, deps, {
      phase: "all",
      firstScreenPluginIds,
    });

    expect(importedPluginIds(importModule).sort()).toEqual([
      "pdf-preview",
      "secrets",
    ]);
  });

  it("an empty first-screen phase does not fetch the plugin list", async () => {
    const fetchCandidates = vi.fn(async () => candidates());
    const state = createPluginFrontendReconcileState();

    await reconcilePluginFrontends(state, makeDeps([], { fetchCandidates }), {
      phase: "first-screen",
      firstScreenPluginIds: new Set(),
    });

    expect(fetchCandidates).not.toHaveBeenCalled();
    expect(state.records.size).toBe(0);
  });

  it("full boot loads a first-screen owner that became ready while the first-screen phase was importing", async () => {
    const imports = makeDeferredImports();
    let installed = [candidate("navigation", 100), candidate("secrets", 500)];
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps([], {
      fetchCandidates: async () => installed,
      importModule: imports.importModule,
    });
    const firstScreen = reconcilePluginFrontends(state, deps, {
      phase: "first-screen",
      firstScreenPluginIds,
    });
    await vi.waitFor(() => expect(imports.started).toHaveLength(1));
    installed = [...installed, candidate("thread-list", 900)];

    let settled = false;
    const fullBoot = reconcileFullPluginFrontendBoot(state, deps, {
      pendingFirstScreenBoot: firstScreen,
      firstScreenPluginIds,
    }).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(imports.started).toHaveLength(2));
    await imports.resolveNext();
    await imports.resolveNext();
    await vi.waitFor(() => expect(imports.started).toHaveLength(3));

    expect(imports.started.map((url) => url.split("/")[4])).toEqual([
      "navigation",
      "secrets",
      "thread-list",
    ]);
    expect(settled).toBe(false);
    await imports.resolveNext();
    await fullBoot;
    expect(state.records.get("thread-list")?.status).toBe("loaded");
    expect(deps.setRegistrations).toHaveBeenCalledTimes(3);
  });

  it("full boot retries a first-screen import that failed while both phases overlapped", async () => {
    let navigationAttempts = 0;
    const importModule = vi.fn(async (url: string) => {
      if (url.includes("/navigation/") && navigationAttempts++ === 0) {
        throw new Error("network");
      }
      return pluginModule();
    });
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(candidates(), { importModule });
    const firstScreen = reconcilePluginFrontends(state, deps, {
      phase: "first-screen",
      firstScreenPluginIds,
    });

    await reconcileFullPluginFrontendBoot(state, deps, {
      pendingFirstScreenBoot: firstScreen,
      firstScreenPluginIds,
    });

    expect(navigationAttempts).toBe(2);
    expect(state.records.get("navigation")?.status).toBe("loaded");
    expect(importedPluginIds(importModule).sort()).toEqual([
      "navigation",
      "navigation",
      "pdf-preview",
      "secrets",
      "thread-list",
    ]);
  });

});
