// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { definePluginApp } from "./plugin-app-definition";
import {
  COMPILED_IN_BUNDLE_HASH,
  createPluginFrontendReconcileState,
  reconcilePluginFrontends,
  seedCompiledInPluginFrontends,
  type CompiledInDisabledMemo,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "./plugin-frontend";

function serverCandidate(pluginId: string, hash: string): PluginFrontendCandidate {
  return {
    pluginId,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=${hash}`,
      cssUrl: `/api/v1/plugins/${pluginId}/assets/app.css?h=${hash}`,
      jsBytes: 10,
      hash,
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
    },
  };
}

function pluginModule(): Record<string, unknown> {
  return { default: definePluginApp(() => {}) };
}

function memoryMemo(initial: string[] = []): CompiledInDisabledMemo & {
  writes: string[][];
} {
  let stored = new Set(initial);
  const writes: string[][] = [];
  return {
    writes,
    read: () => stored,
    write(pluginIds) {
      stored = new Set(pluginIds);
      writes.push([...pluginIds]);
    },
  };
}

function makeDeps(
  candidates: () => PluginFrontendCandidate[],
  overrides: Partial<PluginFrontendReconcileDeps> = {},
): PluginFrontendReconcileDeps {
  return {
    fetchCandidates: async () => candidates(),
    importModule: vi.fn(async () => pluginModule()),
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

describe("compiled-in plugin frontends", () => {
  it("seeds a compiled-in frontend before the inventory answers and never fetches its bundle", async () => {
    const state = createPluginFrontendReconcileState();
    const compiledImport = vi.fn(async () => pluginModule());
    const deps = makeDeps(() => [serverCandidate("thread-list", "server-v1")], {
      compiledIn: new Map([["thread-list", { importModule: compiledImport }]]),
    });

    await seedCompiledInPluginFrontends(state, deps);
    expect(compiledImport).toHaveBeenCalledTimes(1);
    expect(state.records.get("thread-list")?.status).toBe("loaded");
    expect(state.appliedHashes.get("thread-list")).toBe(COMPILED_IN_BUNDLE_HASH);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(1);
    expect(deps.applyCss).toHaveBeenCalledWith("thread-list", null);

    await reconcilePluginFrontends(state, deps);
    expect(compiledImport).toHaveBeenCalledTimes(1);
    expect(deps.importModule).not.toHaveBeenCalled();
    expect(deps.setRegistrations).toHaveBeenCalledTimes(1);
  });

  it("does not reload a compiled-in frontend when the server's bundle hash changes", async () => {
    const state = createPluginFrontendReconcileState();
    const compiledImport = vi.fn(async () => pluginModule());
    let hash = "server-v1";
    const deps = makeDeps(() => [serverCandidate("thread-list", hash)], {
      compiledIn: new Map([["thread-list", { importModule: compiledImport }]]),
    });
    await reconcilePluginFrontends(state, deps);
    hash = "server-v2";
    await reconcilePluginFrontends(state, deps);
    expect(compiledImport).toHaveBeenCalledTimes(1);
    expect(deps.importModule).not.toHaveBeenCalled();
  });

  it("loads other plugins from the server bundle as before", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(
      () => [serverCandidate("thread-list", "s1"), serverCandidate("github", "g1")],
      {
        compiledIn: new Map([
          ["thread-list", { importModule: async () => pluginModule() }],
        ]),
      },
    );
    await reconcilePluginFrontends(state, deps);
    expect(deps.importModule).toHaveBeenCalledTimes(1);
    expect(deps.importModule).toHaveBeenCalledWith(
      "/api/v1/plugins/github/assets/app.js?h=g1",
    );
    expect(deps.applyCss).toHaveBeenCalledWith(
      "github",
      "/api/v1/plugins/github/assets/app.css?h=g1",
    );
  });

  it("removes a seeded frontend the server no longer reports and remembers that for the next boot", async () => {
    const state = createPluginFrontendReconcileState();
    const memo = memoryMemo();
    const compiledImport = vi.fn(async () => pluginModule());
    const deps = makeDeps(() => [], {
      compiledIn: new Map([["thread-list", { importModule: compiledImport }]]),
      compiledInDisabledMemo: memo,
    });
    await seedCompiledInPluginFrontends(state, deps);
    expect(state.records.has("thread-list")).toBe(true);

    await reconcilePluginFrontends(state, deps);
    expect(state.records.has("thread-list")).toBe(false);
    expect(deps.removeRegistrations).toHaveBeenCalledWith("thread-list");
    expect(memo.writes).toEqual([["thread-list"]]);

    const nextBoot = createPluginFrontendReconcileState();
    await seedCompiledInPluginFrontends(nextBoot, deps);
    expect(compiledImport).toHaveBeenCalledTimes(1);
    expect(nextBoot.records.has("thread-list")).toBe(false);
  });

  it("clears the disabled memo once the server reports the plugin again", async () => {
    const state = createPluginFrontendReconcileState();
    const memo = memoryMemo(["thread-list"]);
    const deps = makeDeps(() => [serverCandidate("thread-list", "s1")], {
      compiledIn: new Map([
        ["thread-list", { importModule: async () => pluginModule() }],
      ]),
      compiledInDisabledMemo: memo,
    });
    await seedCompiledInPluginFrontends(state, deps);
    expect(state.records.has("thread-list")).toBe(false);
    await reconcilePluginFrontends(state, deps);
    expect(state.records.get("thread-list")?.status).toBe("loaded");
    expect(memo.writes).toEqual([[]]);
  });

  it("records a compiled-in import failure against the plugin without touching the server bundle", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps(() => [serverCandidate("thread-list", "s1")], {
      compiledIn: new Map([
        [
          "thread-list",
          {
            importModule: async () => {
              throw new Error("chunk missing");
            },
          },
        ],
      ]),
    });
    await seedCompiledInPluginFrontends(state, deps);
    expect(state.records.get("thread-list")).toMatchObject({
      status: "failed",
      error: "chunk missing",
    });
    await reconcilePluginFrontends(state, deps);
    expect(deps.importModule).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("[plugin:thread-list] frontend bundle failed to load"),
    );
  });
});
