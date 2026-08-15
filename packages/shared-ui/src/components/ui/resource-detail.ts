// Narrow entry for the resource detail surface. Settings-side callers import
// from here instead of the resource-list barrel so the collection surface
// (browse grid, viewport, shelves) stays out of the boot path's Settings chunk.
export {
  ResourceDetailActionRow,
  ResourceDetailCollection,
  ResourceDetailList,
  ResourceDetailListItem,
  ResourceDetailPanel,
  type ResourceDetailSurface,
  ResourceDetailStack,
  ResourceOverview,
  ResourcePromptEditor,
  type ResourcePromptContextItem,
  ResourcePromptPreview,
  ResourceProperty,
  ResourcePropertyList,
  ResourceSection,
  ResourceSectionTitle,
} from "./resource/detail-shell";
export {
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailConfigurationSection,
  ResourceDetailIncludesSection,
  ResourceDetailOverviewSection,
  ResourceDetailPage,
  ResourceDetailReleaseSection,
  ResourceDetailSection,
  type ResourceDetailSectionKind,
  type ResourceDetailSectionProps,
} from "./resource/detail-sections";
