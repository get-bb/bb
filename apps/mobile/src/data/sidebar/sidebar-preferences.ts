import type { CollapsibleSidebarSectionId } from "@bb/client-core";

/**
 * Client-local sidebar display preferences (organize + sort + what is
 * collapsed), persisted under the same key names the web app uses in
 * localStorage (apps/app/src/components/sidebar/sidebarCollapsedAtoms.ts) so
 * the two clients read alike. Storage is injected (MMKV in the app, a Map in
 * tests); the store is the single writer and notifies subscribers in-process.
 */

/** "manual" is the web app's "chronological" (drag-ordered sections) mode. */
export type SidebarOrganizeMode = "project" | "machine" | "manual";
export type SidebarSortMode = "updated" | "created" | "alpha";

export type SidebarCollapseKind =
  | "project"
  | "thread"
  | "environment"
  | "section"
  | "machine"
  | "builtIn";

export interface SidebarPreferences {
  organize: SidebarOrganizeMode;
  sort: SidebarSortMode;
  collapsedProjectIds: readonly string[];
  collapsedThreadIds: readonly string[];
  collapsedEnvironmentIds: readonly string[];
  /** Section keys (`buildSectionKey(containerId, sectionId)`). */
  collapsedSectionKeys: readonly string[];
  /** Host ids plus `NO_MACHINE_GROUP_KEY`. */
  collapsedMachineKeys: readonly string[];
  collapsedBuiltInSections: readonly CollapsibleSidebarSectionId[];
  /**
   * Top-level section order per organize mode, as the web stores it (raw
   * section ids plus legacy anchors); `resolveSidebarSectionOrder` reconciles
   * it with the live sections.
   */
  sectionOrder: Readonly<Record<SidebarOrganizeMode, readonly string[]>>;
}

export interface SidebarPreferencesStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface SidebarPreferencesStore {
  getSnapshot(): SidebarPreferences;
  subscribe(listener: () => void): () => void;
  setOrganize(mode: SidebarOrganizeMode): void;
  setSort(sort: SidebarSortMode): void;
  setCollapsed(kind: SidebarCollapseKind, id: string, collapsed: boolean): void;
  toggleCollapsed(kind: SidebarCollapseKind, id: string): void;
  /** Ensure every id is expanded (used to reveal the selected thread). */
  expand(kind: SidebarCollapseKind, ids: Iterable<string>): void;
  setSectionOrder(mode: SidebarOrganizeMode, order: readonly string[]): void;
}

const SIDEBAR_ORGANIZE_STORAGE_KEY = "bb.sidebar.organizationMode";
/** Web `sidebarCollapsedAtoms.ts`: one order per organize mode. */
const SIDEBAR_SECTION_ORDER_STORAGE_KEYS: Record<SidebarOrganizeMode, string> =
  {
    project: "bb.sidebar.sectionOrder",
    manual: "bb.sidebar.manualSectionOrder",
    machine: "bb.sidebar.machineSectionOrder",
  };
const SIDEBAR_SORT_STORAGE_KEY = "bb.sidebar.chronologicalSort";
const COLLAPSED_STORAGE_KEYS: Record<SidebarCollapseKind, string> = {
  project: "bb.sidebar.collapsedProjects",
  thread: "bb.sidebar.collapsedThreads",
  environment: "bb.sidebar.collapsedEnvironments",
  section: "bb.sidebar.collapsedThreadSections",
  machine: "bb.sidebar.collapsedMachines",
  builtIn: "bb.sidebar.collapsedSections",
};

function collapsedList(
  prefs: SidebarPreferences,
  kind: SidebarCollapseKind,
): readonly string[] {
  switch (kind) {
    case "project":
      return prefs.collapsedProjectIds;
    case "thread":
      return prefs.collapsedThreadIds;
    case "environment":
      return prefs.collapsedEnvironmentIds;
    case "section":
      return prefs.collapsedSectionKeys;
    case "machine":
      return prefs.collapsedMachineKeys;
    case "builtIn":
      return prefs.collapsedBuiltInSections;
  }
}

function withCollapsedList(
  prefs: SidebarPreferences,
  kind: SidebarCollapseKind,
  ids: readonly string[],
): SidebarPreferences {
  switch (kind) {
    case "project":
      return { ...prefs, collapsedProjectIds: ids };
    case "thread":
      return { ...prefs, collapsedThreadIds: ids };
    case "environment":
      return { ...prefs, collapsedEnvironmentIds: ids };
    case "section":
      return { ...prefs, collapsedSectionKeys: ids };
    case "machine":
      return { ...prefs, collapsedMachineKeys: ids };
    case "builtIn":
      return {
        ...prefs,
        collapsedBuiltInSections: ids.filter(isCollapsibleSidebarSectionId),
      };
  }
}

const DEFAULT_SIDEBAR_ORGANIZE: SidebarOrganizeMode = "project";
const DEFAULT_SIDEBAR_SORT: SidebarSortMode = "updated";

/** Lenient: unknown stored values fall back to the default. */
function parseSidebarOrganizeMode(
  value: string | null | undefined,
): SidebarOrganizeMode {
  switch (value) {
    case "project":
    case "machine":
    case "manual":
      return value;
    default:
      return DEFAULT_SIDEBAR_ORGANIZE;
  }
}

/** Lenient: the web's legacy `none` sort normalizes to `updated`. */
function parseSidebarSortMode(
  value: string | null | undefined,
): SidebarSortMode {
  switch (value) {
    case "updated":
    case "created":
    case "alpha":
      return value;
    default:
      return DEFAULT_SIDEBAR_SORT;
  }
}

function parseStringList(value: string | undefined): string[] {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && !seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  } catch {
    return [];
  }
}

function isCollapsibleSidebarSectionId(
  value: string,
): value is CollapsibleSidebarSectionId {
  return value === "pinned" || value === "threads";
}

function readPreferences(
  storage: SidebarPreferencesStorage,
): SidebarPreferences {
  return {
    organize: parseSidebarOrganizeMode(
      storage.getString(SIDEBAR_ORGANIZE_STORAGE_KEY),
    ),
    sort: parseSidebarSortMode(storage.getString(SIDEBAR_SORT_STORAGE_KEY)),
    collapsedProjectIds: parseStringList(
      storage.getString(COLLAPSED_STORAGE_KEYS.project),
    ),
    collapsedThreadIds: parseStringList(
      storage.getString(COLLAPSED_STORAGE_KEYS.thread),
    ),
    collapsedEnvironmentIds: parseStringList(
      storage.getString(COLLAPSED_STORAGE_KEYS.environment),
    ),
    collapsedSectionKeys: parseStringList(
      storage.getString(COLLAPSED_STORAGE_KEYS.section),
    ),
    collapsedMachineKeys: parseStringList(
      storage.getString(COLLAPSED_STORAGE_KEYS.machine),
    ),
    collapsedBuiltInSections: parseStringList(
      storage.getString(COLLAPSED_STORAGE_KEYS.builtIn),
    ).filter(isCollapsibleSidebarSectionId),
    sectionOrder: {
      project: parseStringList(
        storage.getString(SIDEBAR_SECTION_ORDER_STORAGE_KEYS.project),
      ),
      manual: parseStringList(
        storage.getString(SIDEBAR_SECTION_ORDER_STORAGE_KEYS.manual),
      ),
      machine: parseStringList(
        storage.getString(SIDEBAR_SECTION_ORDER_STORAGE_KEYS.machine),
      ),
    },
  };
}

export function createSidebarPreferencesStore(
  storage: SidebarPreferencesStorage,
): SidebarPreferencesStore {
  let snapshot = readPreferences(storage);
  const listeners = new Set<() => void>();

  function commit(next: SidebarPreferences): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function writeList(kind: SidebarCollapseKind, ids: readonly string[]): void {
    const key = COLLAPSED_STORAGE_KEYS[kind];
    if (ids.length === 0) storage.remove(key);
    else storage.set(key, JSON.stringify(ids));
    commit(withCollapsedList(snapshot, kind, ids));
  }

  function currentList(kind: SidebarCollapseKind): readonly string[] {
    return collapsedList(snapshot, kind);
  }

  function setCollapsed(
    kind: SidebarCollapseKind,
    id: string,
    collapsed: boolean,
  ): void {
    if (kind === "builtIn" && !isCollapsibleSidebarSectionId(id)) return;
    const current = currentList(kind);
    const isCollapsed = current.includes(id);
    if (isCollapsed === collapsed) return;
    writeList(
      kind,
      collapsed ? [...current, id] : current.filter((item) => item !== id),
    );
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setOrganize(mode) {
      if (mode === snapshot.organize) return;
      if (mode === DEFAULT_SIDEBAR_ORGANIZE) {
        storage.remove(SIDEBAR_ORGANIZE_STORAGE_KEY);
      } else {
        storage.set(SIDEBAR_ORGANIZE_STORAGE_KEY, mode);
      }
      commit({ ...snapshot, organize: mode });
    },
    setSort(sort) {
      if (sort === snapshot.sort) return;
      if (sort === DEFAULT_SIDEBAR_SORT)
        storage.remove(SIDEBAR_SORT_STORAGE_KEY);
      else storage.set(SIDEBAR_SORT_STORAGE_KEY, sort);
      commit({ ...snapshot, sort });
    },
    setCollapsed,
    toggleCollapsed(kind, id) {
      setCollapsed(kind, id, !currentList(kind).includes(id));
    },
    expand(kind, ids) {
      const remove = new Set(ids);
      if (remove.size === 0) return;
      const current = currentList(kind);
      const next = current.filter((item) => !remove.has(item));
      if (next.length === current.length) return;
      writeList(kind, next);
    },
    setSectionOrder(mode, order) {
      const current = snapshot.sectionOrder[mode];
      if (
        current.length === order.length &&
        current.every((id, index) => id === order[index])
      ) {
        return;
      }
      const key = SIDEBAR_SECTION_ORDER_STORAGE_KEYS[mode];
      if (order.length === 0) storage.remove(key);
      else storage.set(key, JSON.stringify(order));
      commit({
        ...snapshot,
        sectionOrder: { ...snapshot.sectionOrder, [mode]: [...order] },
      });
    },
  };
}
