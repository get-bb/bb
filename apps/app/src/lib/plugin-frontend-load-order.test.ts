import { describe, expect, it, vi } from "vitest";
import { definePluginApp } from "./plugin-app-definition";
import { registerLazyPart } from "./lazy-parts";
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
      staticChunkUrls: [],
      lazyChunkUrls: [],
      lazyRuntimeSlots: [],
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
    fetchCandidates: async () => ({ candidates, startingPluginIds: [] }),
    importModule: async () => pluginModule(),
    importRetryDelaysMs: [],
    applyCss: vi.fn(),
    prefetchCss: vi.fn(),
    prefetchModule: vi.fn(),
    retainCss: vi.fn(() => vi.fn()),
    resetCrashedSlots: vi.fn(),
    setRegistrations: vi.fn(),
    removeRegistrations: vi.fn(),
    setLoadingPlugins: vi.fn(),
    settlePluginLoad: vi.fn(),
    warn: vi.fn(),
    priorityPluginIds: () => [],
    restoredLazyParts: () => [],
    whenScreenPainted: () => Promise.resolve(),
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
        restoredLazyParts: () => [],
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
          restoredLazyParts: () => [],
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

  it("holds the other plugins' downloads until the screen paints, so they never compete with it", async () => {
    const imports = makeDeferredImports();
    const prefetchModule = vi.fn();
    let paint = () => {};
    const screenPainted = new Promise<void>((resolve) => {
      paint = resolve;
    });
    const done = reconcilePluginFrontends(
      createPluginFrontendReconcileState(),
      makeDeps(
        [candidate("thread-list", 900), candidate("a", 10), candidate("b", 20)],
        {
          importModule: imports.importModule,
          priorityPluginIds: () => ["thread-list"],
          restoredLazyParts: () => [],
          prefetchModule,
          whenScreenPainted: () => screenPainted,
        },
      ),
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(imports.started).toEqual([
      "/api/v1/plugins/thread-list/assets/app.js?h=h",
    ]);

    await imports.resolveNext();
    expect(imports.started).toHaveLength(1);
    expect(prefetchModule).not.toHaveBeenCalled();

    paint();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(imports.started).toHaveLength(3);
    while (imports.pending() > 0) await imports.resolveNext();
    await done;
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
          restoredLazyParts: () => [],
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

  it("downloads a split bundle's static chunks together with its entry when it downloads ahead", async () => {
    const imports = makeDeferredImports();
    const prefetchModule = vi.fn();
    const split = candidate("split", 40);
    split.bundle.staticChunkUrls = [
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/chunk-A.js",
    ];
    split.bundle.lazyChunkUrls = [
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/Panel-B.js",
    ];
    const done = reconcilePluginFrontends(
      createPluginFrontendReconcileState(),
      makeDeps(
        [
          candidate("thread-list", 900),
          candidate("a", 10),
          candidate("b", 20),
          candidate("c", 30),
          split,
        ],
        {
          importModule: imports.importModule,
          priorityPluginIds: () => ["thread-list"],
          restoredLazyParts: () => [],
          prefetchModule,
        },
      ),
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await imports.resolveNext();

    expect(prefetchModule.mock.calls.map(([url]) => url)).toEqual([
      split.bundle.jsUrl,
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/chunk-A.js",
    ]);
    while (imports.started.length < 5 || imports.pending() > 0) {
      await imports.resolveNext();
    }
    await done;
    expect(prefetchModule.mock.calls.map(([url]) => url)).not.toContain(
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/Panel-B.js",
    );
  });

  function lazyPart() {
    let finish: () => void = () => {};
    const download = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let loaded = false;
    const load = vi.fn(() =>
      download.then(() => {
        loaded = true;
      }),
    );
    function Part() {
      return null;
    }
    registerLazyPart(Part, { load, isLoaded: () => loaded });
    return { Part, load, finish };
  }

  it("publishes a plugin's settings page once the sections it shows load, without loading its other lazy parts", async () => {
    const section = lazyPart();
    const tab = lazyPart();
    const ownerModule = {
      default: definePluginApp((app) => {
        app.slots.settingsSection({ id: "accounts", component: section.Part });
        app.slots.experimental_tab({
          id: "diff",
          title: "Diff",
          icon: "FileDiff",
          context: { kind: "thread" },
          availability: "fixed",
          component: tab.Part,
        });
      }),
    };
    const owner = candidate("owner", 10);
    owner.bundle.lazyChunkUrls = [
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/settings-A.js",
    ];
    const other = candidate("other", 20);
    const setRegistrations = vi.fn();
    const prefetchModule = vi.fn();
    const done = reconcilePluginFrontends(
      createPluginFrontendReconcileState(),
      makeDeps([owner, other], {
        importModule: async (url) =>
          url.includes("/owner/") ? ownerModule : pluginModule(),
        priorityPluginIds: () => ["owner"],
        restoredLazyParts: () => [{ kind: "settings-page", pluginId: "owner" }],
        setRegistrations,
        prefetchModule,
      }),
    );
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    expect(prefetchModule.mock.calls.map(([url]) => url)).toContain(
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/settings-A.js",
    );
    expect(section.load).toHaveBeenCalledTimes(1);
    expect(tab.load).not.toHaveBeenCalled();
    expect(setRegistrations.mock.calls.map(([pluginId]) => pluginId)).toEqual([
      "other",
    ]);

    section.finish();
    await done;
    expect(setRegistrations.mock.calls.map(([pluginId]) => pluginId)).toEqual([
      "other",
      "owner",
    ]);
    expect(tab.load).not.toHaveBeenCalled();
  });

  it("starts the open panel tab's lazy part as soon as its plugin registers, without holding the plugin back", async () => {
    const tab = lazyPart();
    const other = lazyPart();
    const gitModule = {
      default: definePluginApp((app) => {
        app.slots.experimental_tab({
          id: "diff",
          title: "Diff",
          icon: "FileDiff",
          context: { kind: "thread" },
          availability: "fixed",
          component: tab.Part,
        });
        app.slots.experimental_tab({
          id: "history",
          title: "History",
          icon: "Zap",
          context: { kind: "thread" },
          availability: "fixed",
          component: other.Part,
        });
      }),
    };
    const git = candidate("git", 10);
    git.bundle.lazyChunkUrls = [
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/DiffTab-A.js",
    ];
    const setRegistrations = vi.fn();
    const prefetchModule = vi.fn();
    await reconcilePluginFrontends(
      createPluginFrontendReconcileState(),
      makeDeps([git], {
        importModule: async () => gitModule,
        restoredLazyParts: () => [
          { kind: "panel-tab", pluginId: "git", tabId: "diff" },
        ],
        setRegistrations,
        prefetchModule,
      }),
    );

    expect(prefetchModule.mock.calls.map(([url]) => url)).toContain(
      "/api/v1/plugin-app-assets/0123456789abcdef/chunks/DiffTab-A.js",
    );
    expect(tab.load).toHaveBeenCalledTimes(1);
    expect(other.load).not.toHaveBeenCalled();
    expect(setRegistrations.mock.calls.map(([pluginId]) => pluginId)).toEqual([
      "git",
    ]);
    tab.finish();
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
