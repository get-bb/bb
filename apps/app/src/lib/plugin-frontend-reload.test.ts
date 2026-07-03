// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { definePluginApp } from "./plugin-app-definition";
import {
  applyPluginCss,
  createPluginFrontendReconcileScheduler,
  createPluginFrontendReconcileState,
  reconcilePluginFrontends,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "./plugin-frontend";
import {
  getPluginSlotSnapshot,
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";

function candidate(
  pluginId: string,
  hash: string,
  overrides: Partial<PluginFrontendCandidate["bundle"]> = {},
): PluginFrontendCandidate {
  return {
    pluginId,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=${hash}`,
      cssUrl: `/api/v1/plugins/${pluginId}/assets/app.css?h=${hash}`,
      hash,
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
      ...overrides,
    },
  };
}

/** A module namespace whose default export registers one homepage section. */
function pluginModule(sectionTitle: string): Record<string, unknown> {
  return {
    default: definePluginApp((app) => {
      app.slots.homepageSection({
        id: "section",
        title: sectionTitle,
        component: () => null,
      });
    }),
  };
}

function makeDeps(initial: PluginFrontendCandidate[] = []) {
  return {
    fetchCandidates: vi.fn(
      async (): Promise<PluginFrontendCandidate[]> => initial,
    ),
    importModule: vi.fn(
      async (): Promise<unknown> => pluginModule("hello"),
    ),
    applyCss: vi.fn(),
    resetCrashedSlots: vi.fn(),
    setRegistrations: vi.fn(),
    removeRegistrations: vi.fn(),
    warn: vi.fn(),
  } satisfies PluginFrontendReconcileDeps;
}

describe("reconcilePluginFrontends", () => {
  it("re-imports a plugin exactly once when its bundle hash changes, replacing registrations wholesale", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps([
      candidate("hello", "aaa"),
      candidate("other", "s1", { cssUrl: null }),
    ]);

    await reconcilePluginFrontends(state, deps);
    expect(deps.importModule).toHaveBeenCalledTimes(2);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(2);

    // Backend-only broadcast: both hashes unchanged → nothing re-imports,
    // nothing re-registers (no generation bump, no remount).
    deps.importModule.mockClear();
    deps.setRegistrations.mockClear();
    await reconcilePluginFrontends(state, deps);
    expect(deps.importModule).not.toHaveBeenCalled();
    expect(deps.setRegistrations).not.toHaveBeenCalled();

    // hello's bundle hash changes → exactly one re-import, via the fresh
    // hash URL, and exactly one wholesale registration replacement.
    deps.fetchCandidates.mockResolvedValue([
      candidate("hello", "bbb"),
      candidate("other", "s1", { cssUrl: null }),
    ]);
    await reconcilePluginFrontends(state, deps);
    expect(deps.importModule).toHaveBeenCalledTimes(1);
    expect(deps.importModule).toHaveBeenCalledWith(
      "/api/v1/plugins/hello/assets/app.js?h=bbb",
    );
    expect(deps.setRegistrations).toHaveBeenCalledTimes(1);
    expect(deps.setRegistrations).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        homepageSections: [expect.objectContaining({ id: "section" })],
      }),
    );
    // Crashed-slot latches reset before the new registrations remount.
    expect(deps.resetCrashedSlots).toHaveBeenCalledWith("hello");
    // The CSS link is swapped to the fresh-hash URL.
    expect(deps.applyCss).toHaveBeenCalledWith(
      "hello",
      "/api/v1/plugins/hello/assets/app.css?h=bbb",
    );
  });

  it("reloading twice leaves exactly one homepage section registered (design §9 exit criterion)", async () => {
    resetPluginSlotStoreForTest();
    const state = createPluginFrontendReconcileState();
    const fetchCandidates = vi.fn(
      async (): Promise<PluginFrontendCandidate[]> => [
        candidate("hello", "v1"),
      ],
    );
    const deps: PluginFrontendReconcileDeps = {
      fetchCandidates,
      importModule: async () => pluginModule("hello"),
      applyCss: vi.fn(),
      resetCrashedSlots: vi.fn(),
      setRegistrations: setPluginSlotRegistrations,
      removeRegistrations: removePluginSlotRegistrations,
      warn: vi.fn(),
    };

    await reconcilePluginFrontends(state, deps); // boot
    fetchCandidates.mockResolvedValue([candidate("hello", "v2")]);
    await reconcilePluginFrontends(state, deps); // reload 1
    fetchCandidates.mockResolvedValue([candidate("hello", "v3")]);
    await reconcilePluginFrontends(state, deps); // reload 2

    const snapshot = getPluginSlotSnapshot();
    expect(snapshot.homepageSections).toHaveLength(1);
    expect(snapshot.homepageSections[0]).toMatchObject({
      pluginId: "hello",
      id: "section",
      // Three wholesale replacements → three generation bumps (remounts).
      generation: 3,
    });
    resetPluginSlotStoreForTest();
  });

  it("drops registrations, CSS, and record when a plugin disappears from the inventory", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps([candidate("hello", "v1")]);
    await reconcilePluginFrontends(state, deps);
    expect(state.records.get("hello")?.status).toBe("loaded");

    deps.fetchCandidates.mockResolvedValue([]); // disabled/removed/stopped
    await reconcilePluginFrontends(state, deps);
    expect(deps.removeRegistrations).toHaveBeenCalledWith("hello");
    expect(deps.applyCss).toHaveBeenLastCalledWith("hello", null);
    expect(state.records.has("hello")).toBe(false);
    expect(state.appliedHashes.has("hello")).toBe(false);
  });

  it("removes previous UI when a re-import fails, and when the bundle goes needs-update", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps([candidate("hello", "v1")]);
    await reconcilePluginFrontends(state, deps);

    deps.fetchCandidates.mockResolvedValue([candidate("hello", "v2")]);
    deps.importModule.mockRejectedValueOnce(new Error("SyntaxError"));
    await reconcilePluginFrontends(state, deps);
    expect(state.records.get("hello")).toMatchObject({ status: "failed" });
    expect(deps.removeRegistrations).toHaveBeenCalledWith("hello");
    expect(deps.applyCss).toHaveBeenLastCalledWith("hello", null);

    deps.removeRegistrations.mockClear();
    deps.fetchCandidates.mockResolvedValue([
      candidate("hello", "v3", { compatible: false, sdkMajor: 9 }),
    ]);
    await reconcilePluginFrontends(state, deps);
    expect(state.records.get("hello")).toMatchObject({
      status: "needs-update",
    });
    expect(deps.removeRegistrations).toHaveBeenCalledWith("hello");
  });

  it("removes a stale CSS link when the new bundle ships no CSS", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps([candidate("hello", "v1")]);
    await reconcilePluginFrontends(state, deps);
    expect(deps.applyCss).toHaveBeenCalledWith(
      "hello",
      "/api/v1/plugins/hello/assets/app.css?h=v1",
    );

    deps.fetchCandidates.mockResolvedValue([
      candidate("hello", "v2", { cssUrl: null }),
    ]);
    await reconcilePluginFrontends(state, deps);
    expect(deps.applyCss).toHaveBeenLastCalledWith("hello", null);
  });
});

describe("applyPluginCss", () => {
  afterEach(() => {
    for (const link of [
      ...document.head.querySelectorAll("link[data-bb-plugin-css]"),
    ]) {
      link.remove();
    }
  });

  function links(pluginId: string): HTMLLinkElement[] {
    return [
      ...document.head.querySelectorAll<HTMLLinkElement>(
        `link[data-bb-plugin-css="${pluginId}"]`,
      ),
    ];
  }

  it("keeps the old link until the new one loads, then removes it (no unstyled flash)", () => {
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    expect(links("hello")).toHaveLength(1);

    applyPluginCss("hello", "/assets/app.css?h=bbb");
    // Both links coexist while the fresh sheet is still loading.
    const during = links("hello");
    expect(during.map((l) => l.getAttribute("href"))).toEqual([
      "/assets/app.css?h=aaa",
      "/assets/app.css?h=bbb",
    ]);

    during[1]?.dispatchEvent(new Event("load"));
    const after = links("hello");
    expect(after).toHaveLength(1);
    expect(after[0]?.getAttribute("href")).toBe("/assets/app.css?h=bbb");
  });

  it("on load error, drops the new link and keeps the old sheet working", () => {
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    applyPluginCss("hello", "/assets/app.css?h=bbb");
    const fresh = links("hello")[1];

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fresh?.dispatchEvent(new Event("error"));
    warn.mockRestore();

    const after = links("hello");
    expect(after).toHaveLength(1);
    expect(after[0]?.getAttribute("href")).toBe("/assets/app.css?h=aaa");
  });

  it("keeps the same element for an unchanged URL and removes it on null", () => {
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    const first = links("hello")[0];
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    expect(links("hello")[0]).toBe(first);

    applyPluginCss("hello", null);
    expect(links("hello")).toHaveLength(0);
  });
});

describe("createPluginFrontendReconcileScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of schedules into one run", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const scheduler = createPluginFrontendReconcileScheduler({
      run,
      debounceMs: 250,
    });

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("serializes runs: a schedule landing mid-run queues one follow-up, never overlaps", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    let release = (): void => {};
    const run = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      active -= 1;
    });
    const scheduler = createPluginFrontendReconcileScheduler({
      run,
      debounceMs: 250,
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1);

    // Two more broadcasts while the first run is still in flight.
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(250);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1); // queued, not overlapped

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2); // exactly one follow-up
    expect(maxActive).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
