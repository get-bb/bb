import type { SidebarOrganizationMode } from "@bb/domain";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export type {
  CollapsibleSidebarSectionId,
  SidebarSectionId,
} from "@bb/client-core";

export type { SidebarOrganizationMode };

export const collapsedProjectIdsAtom = createSyncedPreferenceAtom(
  "sidebar.collapsedProjects",
);

export const collapsedThreadIdsAtom = createSyncedPreferenceAtom(
  "sidebar.collapsedThreads",
);

export const collapsedEnvironmentIdsAtom = createSyncedPreferenceAtom(
  "sidebar.collapsedEnvironments",
);

export const collapsedSidebarSectionIdsAtom = createSyncedPreferenceAtom(
  "sidebar.collapsedSections",
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

export const sidebarHiddenGroupsAtom = createSyncedPreferenceAtom(
  "sidebar.hiddenGroups",
);

export const sidebarOrganizationModeAtom = createSyncedPreferenceAtom(
  "sidebar.organizationMode",
);

export const sidebarCollapsedThreadSectionsAtom = createSyncedPreferenceAtom(
  "sidebar.collapsedThreadSections",
);

export const sidebarCollapsedMachinesAtom = createSyncedPreferenceAtom(
  "sidebar.collapsedMachines",
);
