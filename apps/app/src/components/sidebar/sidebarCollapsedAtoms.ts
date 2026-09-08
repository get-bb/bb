import { atomWithStorage } from "jotai/utils";
import type { CollapsibleSidebarSectionId } from "@bb/client-core";
import type {
  SidebarChronologicalSort,
  SidebarOrganizationMode,
} from "@bb/domain";
import {
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

const COLLAPSED_PROJECTS_STORAGE_KEY = "bb.sidebar.collapsedProjects";
const COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedThreads";
const COLLAPSED_ENVIRONMENTS_STORAGE_KEY = "bb.sidebar.collapsedEnvironments";
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY = "bb.sidebar.collapsedSections";
const COLLAPSED_THREAD_SECTIONS_STORAGE_KEY =
  "bb.sidebar.collapsedThreadSections";
const LEGACY_COLLAPSED_FOLDERS_STORAGE_KEY = "bb.sidebar.collapsedFolders";
const COLLAPSED_MACHINES_STORAGE_KEY = "bb.sidebar.collapsedMachines";

export type {
  CollapsibleSidebarSectionId,
  SidebarSectionId,
} from "@bb/client-core";

export type { SidebarChronologicalSort, SidebarOrganizationMode };

function createLegacyMigratingStringArrayStorage(
  legacyKey: string,
  migrateItem: (item: string) => string,
): SyncStorage<string[]> {
  const storage = createJsonLocalStorage<string[]>();

  return {
    getItem(key, initialValue) {
      if (
        typeof window === "undefined" ||
        window.localStorage.getItem(key) !== null
      ) {
        return storage.getItem(key, initialValue);
      }

      const legacyJson = window.localStorage.getItem(legacyKey);
      if (legacyJson === null) {
        return initialValue;
      }
      let parsedLegacyValue: unknown;
      try {
        parsedLegacyValue = JSON.parse(legacyJson);
      } catch {
        storage.removeItem(legacyKey);
        return initialValue;
      }
      if (!Array.isArray(parsedLegacyValue)) {
        storage.removeItem(legacyKey);
        return initialValue;
      }
      const migratedValue = parsedLegacyValue
        .filter((item): item is string => typeof item === "string")
        .map(migrateItem);
      storage.setItem(key, migratedValue);
      storage.removeItem(legacyKey);
      return migratedValue;
    },
    setItem: storage.setItem,
    removeItem(key) {
      storage.removeItem(key);
      storage.removeItem(legacyKey);
    },
    subscribe: storage.subscribe,
  };
}

const collapsedThreadSectionsStorage = createLegacyMigratingStringArrayStorage(
  LEGACY_COLLAPSED_FOLDERS_STORAGE_KEY,
  (item) => item,
);

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

export const sidebarSectionOrderAtom = createSyncedPreferenceAtom(
  "sidebar.sectionOrder",
);

export const sidebarManualSectionOrderAtom = createSyncedPreferenceAtom(
  "sidebar.manualSectionOrder",
);

export const sidebarMachineSectionOrderAtom = createSyncedPreferenceAtom(
  "sidebar.machineSectionOrder",
);

export const sidebarOrganizationModeAtom = createSyncedPreferenceAtom(
  "sidebar.organizationMode",
);

export const sidebarChronologicalSortAtom = createSyncedPreferenceAtom(
  "sidebar.chronologicalSort",
);

export const sidebarCollapsedThreadSectionsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREAD_SECTIONS_STORAGE_KEY,
  [],
  collapsedThreadSectionsStorage,
  { getOnInit: true },
);

export const sidebarCollapsedMachinesAtom = atomWithStorage<string[]>(
  COLLAPSED_MACHINES_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
