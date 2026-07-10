import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const COLLAPSED_PROJECTS_STORAGE_KEY = "bb.sidebar.collapsedProjects";
const COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedThreads";
const COLLAPSED_ENVIRONMENTS_STORAGE_KEY = "bb.sidebar.collapsedEnvironments";
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY = "bb.sidebar.collapsedSections";
const SIDEBAR_SECTION_ORDER_STORAGE_KEY = "bb.sidebar.sectionOrder";
const ORGANIZATION_MODE_STORAGE_KEY = "bb.sidebar.organizationMode";
const CHRONOLOGICAL_SORT_STORAGE_KEY = "bb.sidebar.chronologicalSort";
const SORT_DIRECTION_STORAGE_KEY = "bb.sidebar.sortDirection";
const COLLAPSED_FOLDERS_STORAGE_KEY = "bb.sidebar.collapsedFolders";

export type SidebarSectionId = "pinned" | "projects" | "threads";
export type CollapsibleSidebarSectionId =
  | "folders"
  | "pinned"
  | "projects"
  | "threads";

// "project" keeps the per-project grouping; "chronological" is the persisted
// value for the cross-project Folders view that replaced the old None view.
export type SidebarOrganizationMode = "project" | "chronological";
// Controls thread ordering in both grouped and ungrouped sidebar views.
// "updated" reuses the status-aware activity heuristic; "created" sorts by
// the literal createdAt field; "alpha" sorts by display title. "none" is a
// legacy/internal value that the runtime normalizes back to "updated".
export type SidebarChronologicalSort = "updated" | "created" | "alpha" | "none";
export type SidebarSortDirection = "asc" | "desc";

export const DEFAULT_SIDEBAR_SECTION_ORDER: readonly SidebarSectionId[] = [
  "pinned",
  "projects",
  "threads",
];

export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_PROJECTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedThreadIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREADS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
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

export const sidebarOrganizationModeAtom =
  atomWithStorage<SidebarOrganizationMode>(
    ORGANIZATION_MODE_STORAGE_KEY,
    "project",
    createJsonLocalStorage<SidebarOrganizationMode>(),
    { getOnInit: true },
  );

export const sidebarChronologicalSortAtom =
  atomWithStorage<SidebarChronologicalSort>(
    CHRONOLOGICAL_SORT_STORAGE_KEY,
    "updated",
    createJsonLocalStorage<SidebarChronologicalSort>(),
    { getOnInit: true },
  );

export const sidebarSortDirectionAtom = atomWithStorage<SidebarSortDirection>(
  SORT_DIRECTION_STORAGE_KEY,
  "desc",
  createJsonLocalStorage<SidebarSortDirection>(),
  { getOnInit: true },
);

// Collapsed folder keys (see buildFolderKey in folderKeys.ts). A plain string[],
// matching collapsedThreadIds / collapsedProjectIds.
export const sidebarCollapsedFoldersAtom = atomWithStorage<string[]>(
  COLLAPSED_FOLDERS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
