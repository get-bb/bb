// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  buildSidebarEntitySectionId,
  isSidebarSectionId,
  reorderSidebarSectionOrder,
  normalizeSidebarSectionOrder,
} from "@bb/client-core";
export type {
  SidebarEntitySectionKind,
  LegacySidebarEntityAnchor,
} from "@bb/client-core";
