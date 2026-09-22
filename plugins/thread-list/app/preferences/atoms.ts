import { atom } from "jotai";
import { createSyncedPreferenceAtom } from "./synced-preference-atom.js";

export const collapsedProjectIdsAtom =
  createSyncedPreferenceAtom("collapsedProjects");
export const collapsedThreadIdsAtom =
  createSyncedPreferenceAtom("collapsedThreads");
export const collapsedEnvironmentIdsAtom = createSyncedPreferenceAtom(
  "collapsedEnvironments",
);
export const collapsedSidebarSectionIdsAtom =
  createSyncedPreferenceAtom("collapsedSections");
export const sidebarSectionOrderAtom =
  createSyncedPreferenceAtom("sectionOrder");
export const sidebarManualSectionOrderAtom =
  createSyncedPreferenceAtom("manualSectionOrder");
export const sidebarMachineSectionOrderAtom = createSyncedPreferenceAtom(
  "machineSectionOrder",
);
export const sidebarHiddenGroupsAtom =
  createSyncedPreferenceAtom("hiddenGroups");
export const sidebarOrganizationModeAtom =
  createSyncedPreferenceAtom("organizationMode");
export const sidebarEnvironmentGroupingAtom = createSyncedPreferenceAtom(
  "environmentGrouping",
);
export const sidebarGroupThreadsByEnvironmentAtom = atom((get) => {
  const grouping = get(sidebarEnvironmentGroupingAtom);
  if (grouping !== "auto") return grouping;
  return get(sidebarOrganizationModeAtom) !== "chronological";
});
export const sidebarShowProviderIconsAtom =
  createSyncedPreferenceAtom("showProviderIcons");
export const sidebarProviderIconColorAtom =
  createSyncedPreferenceAtom("providerIconColor");
export const sidebarProviderIconColorsAtom =
  createSyncedPreferenceAtom("providerIconColors");
export const sidebarChronologicalSortAtom =
  createSyncedPreferenceAtom("chronologicalSort");
export const sidebarSortDirectionAtom =
  createSyncedPreferenceAtom("sortDirection");
export const sidebarCollapsedThreadSectionsAtom = createSyncedPreferenceAtom(
  "collapsedThreadSections",
);
export const sidebarCollapsedMachinesAtom =
  createSyncedPreferenceAtom("collapsedMachines");

export const sidebarThreadLifecyclesAtom =
  createSyncedPreferenceAtom("threadLifecycles");
