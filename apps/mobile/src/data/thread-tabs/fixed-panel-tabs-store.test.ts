import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
  FIXED_PANEL_TABS_IDLE_EXPIRY_MS,
  getFixedPanelTabsStateStorageKey,
  openSecondaryPanelTabInState,
} from "@bb/client-core";
import { describe, expect, it, vi } from "vitest";
import {
  createFixedPanelTabsStore,
  type FixedPanelTabsStorage,
} from "./fixed-panel-tabs-store";

function createMapStorage(): FixedPanelTabsStorage & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

describe("createFixedPanelTabsStore", () => {
  it("round-trips the panel state through storage under the web's key and notifies subscribers", () => {
    const storage = createMapStorage();
    let now = 1_000;
    const store = createFixedPanelTabsStore({ storage, now: () => now });
    const listener = vi.fn();
    store.subscribe("thr_1", listener);

    const info = createThreadInfoFixedPanelTab();
    store.update("thr_1", (state) =>
      openSecondaryPanelTabInState({ state, tab: info }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get("thr_1").secondary.activeTabId).toBe(info.id);
    expect(store.get("thr_1").lastUsedAt).toBe(1_000);
    expect(
      storage.map.has(getFixedPanelTabsStateStorageKey({ threadId: "thr_1" })),
    ).toBe(true);

    // A fresh store (new process) reads the persisted blob back.
    now = 2_000;
    const reloaded = createFixedPanelTabsStore({ storage, now: () => now });
    expect(reloaded.get("thr_1").secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
    ]);
    expect(reloaded.get("thr_1").secondary.activeTabId).toBe(info.id);
  });

  it("skips the write and the notification when the updater returns the same state", () => {
    const storage = createMapStorage();
    const store = createFixedPanelTabsStore({ storage, now: () => 1 });
    const listener = vi.fn();
    store.subscribe("thr_1", listener);
    const before = store.get("thr_1");
    expect(store.update("thr_1", (state) => state)).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it("drops state idle for longer than the client-core expiry on read", () => {
    const storage = createMapStorage();
    let now = 10_000;
    const store = createFixedPanelTabsStore({ storage, now: () => now });
    store.update("thr_1", (state) =>
      openSecondaryPanelTabInState({
        state,
        tab: createGitDiffFixedPanelTab(),
      }),
    );
    now = 10_000 + FIXED_PANEL_TABS_IDLE_EXPIRY_MS + 1;
    const reloaded = createFixedPanelTabsStore({ storage, now: () => now });
    expect(reloaded.get("thr_1").secondary.tabs).toEqual([]);
  });

  it("keeps panels independent", () => {
    const storage = createMapStorage();
    const store = createFixedPanelTabsStore({ storage, now: () => 1 });
    const other = vi.fn();
    store.subscribe("thr_2", other);
    store.update("thr_1", (state) =>
      openSecondaryPanelTabInState({
        state,
        tab: createThreadInfoFixedPanelTab(),
      }),
    );
    expect(other).not.toHaveBeenCalled();
    expect(store.get("thr_2").secondary.tabs).toEqual([]);
  });
});
