import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const COLLAPSED_PROJECTS_STORAGE_KEY = "bb.sidebar.collapsedProjects";
const COLLAPSED_MANAGERS_STORAGE_KEY = "bb.sidebar.collapsedManagers";
const COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedThreads";
const COLLAPSED_ENVIRONMENTS_STORAGE_KEY = "bb.sidebar.collapsedEnvironments";
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY = "bb.sidebar.collapsedSections";
const SIDEBAR_SECTION_ORDER_STORAGE_KEY = "bb.sidebar.sectionOrder";

export type SidebarSectionId = "pinned" | "projects" | "threads" | "apps";
export type CollapsibleSidebarSectionId = "projects" | "threads" | "apps";

export const DEFAULT_SIDEBAR_SECTION_ORDER: readonly SidebarSectionId[] = [
  "pinned",
  "projects",
  "threads",
  "apps",
];

export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_PROJECTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

function parseStoredStringArray(storedValue: string): string[] | null {
  try {
    const parsedValue = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return null;
    }
    const values: string[] = [];
    for (const value of parsedValue) {
      if (typeof value !== "string") {
        return null;
      }
      values.push(value);
    }
    return values;
  } catch {
    return null;
  }
}

function migrateCollapsedManagersToThreadsStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  const oldStoredValue = window.localStorage.getItem(
    COLLAPSED_MANAGERS_STORAGE_KEY,
  );
  if (oldStoredValue === null) {
    return;
  }

  const newStoredValue = window.localStorage.getItem(
    COLLAPSED_THREADS_STORAGE_KEY,
  );
  if (newStoredValue !== null) {
    window.localStorage.removeItem(COLLAPSED_MANAGERS_STORAGE_KEY);
    return;
  }

  const collapsedThreadIds = parseStoredStringArray(oldStoredValue);
  if (collapsedThreadIds !== null) {
    window.localStorage.setItem(
      COLLAPSED_THREADS_STORAGE_KEY,
      JSON.stringify(collapsedThreadIds),
    );
  }
  window.localStorage.removeItem(COLLAPSED_MANAGERS_STORAGE_KEY);
}

const collapsedThreadIdsJsonStorage = createJsonLocalStorage<string[]>();

const collapsedThreadIdsStorage: typeof collapsedThreadIdsJsonStorage = {
  ...collapsedThreadIdsJsonStorage,
  getItem: (key, initialValue) => {
    migrateCollapsedManagersToThreadsStorage();
    return collapsedThreadIdsJsonStorage.getItem(key, initialValue);
  },
};

export const collapsedThreadIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREADS_STORAGE_KEY,
  [],
  collapsedThreadIdsStorage,
  { getOnInit: true },
);

export const collapsedEnvironmentIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_ENVIRONMENTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedSidebarSectionIdsAtom = atomWithStorage<
  CollapsibleSidebarSectionId[]
>(
  COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY,
  [],
  createJsonLocalStorage<CollapsibleSidebarSectionId[]>(),
  { getOnInit: true },
);

export const sidebarSectionOrderAtom = atomWithStorage<SidebarSectionId[]>(
  SIDEBAR_SECTION_ORDER_STORAGE_KEY,
  [...DEFAULT_SIDEBAR_SECTION_ORDER],
  createJsonLocalStorage<SidebarSectionId[]>(),
  { getOnInit: true },
);
