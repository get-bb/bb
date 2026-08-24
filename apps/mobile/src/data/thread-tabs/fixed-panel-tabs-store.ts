import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  serializeFixedPanelTabsState,
  type FixedPanelTabsState,
} from "@bb/client-core";

/**
 * Device-local workspace-panel state per panel (a thread id, or the
 * root-compose panel's id): the client-core `FixedPanelTabsState` blob under
 * the web's storage key (`bb.thread.fixedPanelTabsState-<id>-1`), so the
 * active tab survives leaving and re-entering a thread. Storage is injected
 * (MMKV in the app, a Map in tests); the store is the single writer and
 * notifies per-panel subscribers in-process. Parsing applies client-core's
 * rules (schema, normalization, 14-day idle expiry).
 */

export interface FixedPanelTabsStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export type FixedPanelTabsStateUpdater = (
  state: FixedPanelTabsState,
) => FixedPanelTabsState;

export interface FixedPanelTabsStore {
  get(panelStateId: string): FixedPanelTabsState;
  /**
   * Apply `updater`; an identical result (same reference) writes nothing and
   * notifies nobody. A changed result is stamped `lastUsedAt = now`,
   * serialized, and broadcast. Returns the stored state.
   */
  update(
    panelStateId: string,
    updater: FixedPanelTabsStateUpdater,
  ): FixedPanelTabsState;
  subscribe(panelStateId: string, listener: () => void): () => void;
}

export interface CreateFixedPanelTabsStoreOptions {
  storage: FixedPanelTabsStorage;
  now?: () => number;
}

export function createFixedPanelTabsStore({
  storage,
  now = () => Date.now(),
}: CreateFixedPanelTabsStoreOptions): FixedPanelTabsStore {
  const cache = new Map<string, FixedPanelTabsState>();
  const listeners = new Map<string, Set<() => void>>();

  function read(panelStateId: string): FixedPanelTabsState {
    const cached = cache.get(panelStateId);
    if (cached !== undefined) return cached;
    const key = getFixedPanelTabsStateStorageKey({ threadId: panelStateId });
    const state = parseFixedPanelTabsState({
      initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
      now: now(),
      storedValue: storage.getString(key) ?? null,
    });
    cache.set(panelStateId, state);
    return state;
  }

  function notify(panelStateId: string): void {
    const set = listeners.get(panelStateId);
    if (!set) return;
    for (const listener of Array.from(set)) listener();
  }

  return {
    get: read,
    update(panelStateId, updater) {
      const current = read(panelStateId);
      const next = updater(current);
      if (next === current) return current;
      const touched: FixedPanelTabsState = { ...next, lastUsedAt: now() };
      cache.set(panelStateId, touched);
      const key = getFixedPanelTabsStateStorageKey({ threadId: panelStateId });
      storage.set(key, serializeFixedPanelTabsState({ state: touched }));
      notify(panelStateId);
      return touched;
    },
    subscribe(panelStateId, listener) {
      let set = listeners.get(panelStateId);
      if (!set) {
        set = new Set();
        listeners.set(panelStateId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(panelStateId);
      };
    },
  };
}
