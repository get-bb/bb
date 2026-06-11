import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const COLLAPSED_PROJECTS_STORAGE_KEY = "bb.sidebar.collapsedProjects";
const LEGACY_COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedManagers";
const COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedThreads";
const COLLAPSED_ENVIRONMENTS_STORAGE_KEY = "bb.sidebar.collapsedEnvironments";
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY = "bb.sidebar.collapsedSections";
const SIDEBAR_SECTION_ORDER_STORAGE_KEY = "bb.sidebar.sectionOrder";

export type SidebarSectionId =
  | "pinned"
  | "projects"
  | "threads"
  | "workflows";
export type CollapsibleSidebarSectionId =
  | "projects"
  | "threads"
  | "workflows";

export const DEFAULT_SIDEBAR_SECTION_ORDER: readonly SidebarSectionId[] = [
  "pinned",
  "projects",
  "threads",
  "workflows",
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

function migrateLegacyCollapsedThreadsStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  const legacyStoredValue = window.localStorage.getItem(
    LEGACY_COLLAPSED_THREADS_STORAGE_KEY,
  );
  if (legacyStoredValue === null) {
    return;
  }

  const newStoredValue = window.localStorage.getItem(
    COLLAPSED_THREADS_STORAGE_KEY,
  );
  if (newStoredValue !== null) {
    window.localStorage.removeItem(LEGACY_COLLAPSED_THREADS_STORAGE_KEY);
    return;
  }

  const collapsedThreadIds = parseStoredStringArray(legacyStoredValue);
  if (collapsedThreadIds !== null) {
    window.localStorage.setItem(
      COLLAPSED_THREADS_STORAGE_KEY,
      JSON.stringify(collapsedThreadIds),
    );
  }
  window.localStorage.removeItem(LEGACY_COLLAPSED_THREADS_STORAGE_KEY);
}

const collapsedThreadIdsJsonStorage = createJsonLocalStorage<string[]>();

const collapsedThreadIdsStorage: typeof collapsedThreadIdsJsonStorage = {
  ...collapsedThreadIdsJsonStorage,
  getItem: (key, initialValue) => {
    migrateLegacyCollapsedThreadsStorage();
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
