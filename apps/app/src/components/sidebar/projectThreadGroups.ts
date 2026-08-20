// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  CHRONOLOGICAL_CONTAINER_ID,
  compareByCreatedAtDescending,
  compareStandardThreads,
  getProjectThreadItemDescendants,
  createSidebarProjectIdResolver,
  resolveSidebarProjectId,
  buildProjectThreadGroups,
  buildChronologicalThreadList,
  buildSectionThreadList,
  isSidebarProjectThread,
  getSidebarDndItemId,
  countProjectThreadItemRows,
  projectThreadItemContainsThread,
  collectProjectThreadItemNavigationEntries,
} from "@bb/client-core";
export type {
  ProjectThreadNode,
  EnvironmentThreadGroup,
  SidebarSectionDefinition,
  SidebarSectionGroup,
  ProjectThreadItem,
  ThreadComparator,
  ProjectThreadItemRowCountContext,
  ProjectThreadItemNavigationEntry,
} from "@bb/client-core";
