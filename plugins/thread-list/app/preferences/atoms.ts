import { atom } from "jotai";
import { createRevealableCollapsedAtoms } from "./revealable-collapsed-atom.js";
import { createSyncedPreferenceAtom } from "./synced-preference-atom.js";

const collapsedProjects = createRevealableCollapsedAtoms(
  createSyncedPreferenceAtom("collapsedProjects"),
);
export const collapsedProjectIdsAtom = collapsedProjects.collapsed;
export const revealProjectIdsAtom = collapsedProjects.reveal;
const collapsedThreads = createRevealableCollapsedAtoms(
  createSyncedPreferenceAtom("collapsedThreads"),
);
export const collapsedThreadIdsAtom = collapsedThreads.collapsed;
export const revealThreadIdsAtom = collapsedThreads.reveal;
const collapsedEnvironments = createRevealableCollapsedAtoms(
  createSyncedPreferenceAtom("collapsedEnvironments"),
);
export const collapsedEnvironmentIdsAtom = collapsedEnvironments.collapsed;
export const revealEnvironmentIdsAtom = collapsedEnvironments.reveal;
const collapsedSidebarSections = createRevealableCollapsedAtoms(
  createSyncedPreferenceAtom("collapsedSections"),
);
export const collapsedSidebarSectionIdsAtom =
  collapsedSidebarSections.collapsed;
export const revealSidebarSectionIdsAtom = collapsedSidebarSections.reveal;
export const sidebarSectionOrderAtom =
  createSyncedPreferenceAtom("sectionOrder");
export const sidebarManualSectionOrderAtom =
  createSyncedPreferenceAtom("manualSectionOrder");
export const sidebarMachineSectionOrderAtom = createSyncedPreferenceAtom(
  "machineSectionOrder",
);
export const sidebarHiddenGroupsAtom =
  createSyncedPreferenceAtom("hiddenGroups");
export const threadRowActionsAtom = createSyncedPreferenceAtom("rowActions");
export const sidebarOrganizationModeAtom =
  createSyncedPreferenceAtom("organizationMode");
export const sidebarEnvironmentGroupingAtom = createSyncedPreferenceAtom(
  "environmentGrouping",
);
export const sidebarGroupByReadStatusAtom =
  createSyncedPreferenceAtom("groupByReadStatus");
export const sidebarGroupThreadsByEnvironmentAtom = atom((get) => {
  if (get(sidebarGroupByReadStatusAtom)) return false;
  const grouping = get(sidebarEnvironmentGroupingAtom);
  if (grouping !== "auto") return grouping;
  return get(sidebarOrganizationModeAtom) !== "chronological";
});
export const sidebarChronologicalSortAtom =
  createSyncedPreferenceAtom("chronologicalSort");
export const sidebarSortDirectionAtom =
  createSyncedPreferenceAtom("sortDirection");
const collapsedThreadSections = createRevealableCollapsedAtoms(
  createSyncedPreferenceAtom("collapsedThreadSections"),
);
export const sidebarCollapsedThreadSectionsAtom =
  collapsedThreadSections.collapsed;
export const revealThreadSectionKeysAtom = collapsedThreadSections.reveal;
const collapsedMachines = createRevealableCollapsedAtoms(
  createSyncedPreferenceAtom("collapsedMachines"),
);
export const sidebarCollapsedMachinesAtom = collapsedMachines.collapsed;
export const revealMachineKeysAtom = collapsedMachines.reveal;

export const sidebarThreadLifecyclesAtom =
  createSyncedPreferenceAtom("threadLifecycles");
export const sidebarShowProviderIconsAtom =
  createSyncedPreferenceAtom("showProviderIcons");
export const sidebarShowRowMetadataAtom =
  createSyncedPreferenceAtom("showRowMetadata");
export const THREAD_ROW_METADATA_EXPERIMENT = "threadRowMetadata";
export const sidebarShowEmptyProjectsAtom =
  createSyncedPreferenceAtom("showEmptyProjects");
