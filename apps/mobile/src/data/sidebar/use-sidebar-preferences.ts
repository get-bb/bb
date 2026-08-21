import { useMemo, useSyncExternalStore } from "react";
import {
  createSidebarPreferencesStore,
  type SidebarCollapseKind,
  type SidebarOrganizeMode,
  type SidebarPreferences,
  type SidebarPreferencesStore,
  type SidebarSortMode,
} from "./sidebar-preferences";
import { createSidebarPreferencesStorage } from "./sidebar-preferences-storage";

let defaultStore: SidebarPreferencesStore | null = null;

/** App-wide store (client-local, not per server profile). */
function getSidebarPreferencesStore(): SidebarPreferencesStore {
  defaultStore ??= createSidebarPreferencesStore(
    createSidebarPreferencesStorage(),
  );
  return defaultStore;
}

export interface SidebarPreferenceActions {
  setOrganize(mode: SidebarOrganizeMode): void;
  setSort(sort: SidebarSortMode): void;
  setCollapsed(kind: SidebarCollapseKind, id: string, collapsed: boolean): void;
  toggleCollapsed(kind: SidebarCollapseKind, id: string): void;
  expand(kind: SidebarCollapseKind, ids: Iterable<string>): void;
  setSectionOrder(mode: SidebarOrganizeMode, order: readonly string[]): void;
}

/** Persisted organize/sort/collapsed state plus the setters (stable identity). */
export function useSidebarPreferences(
  store: SidebarPreferencesStore = getSidebarPreferencesStore(),
): [SidebarPreferences, SidebarPreferenceActions] {
  const preferences = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const actions = useMemo<SidebarPreferenceActions>(
    () => ({
      setOrganize: store.setOrganize,
      setSort: store.setSort,
      setCollapsed: store.setCollapsed,
      toggleCollapsed: store.toggleCollapsed,
      expand: store.expand,
      setSectionOrder: store.setSectionOrder,
    }),
    [store],
  );
  return [preferences, actions];
}

/** Collapse state as sets, for O(1) row lookups while rendering. */
export function useSidebarCollapsedSets(preferences: SidebarPreferences) {
  return useMemo(
    () => ({
      projectIds: new Set(preferences.collapsedProjectIds),
      threadIds: new Set(preferences.collapsedThreadIds),
      environmentIds: new Set(preferences.collapsedEnvironmentIds),
      sectionKeys: new Set(preferences.collapsedSectionKeys),
      machineKeys: new Set(preferences.collapsedMachineKeys),
      builtInSections: new Set(preferences.collapsedBuiltInSections),
    }),
    [preferences],
  );
}
