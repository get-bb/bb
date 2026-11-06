import {
  uiPreferenceDefinitions,
  type UiPreferenceEntries,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import { z } from "zod";

export type PathUiPreferenceKey = { param: { key: string } };

export interface UiPreferencesResponse {
  preferences: UiPreferenceEntries;
}

export interface UiPreferenceResponse<
  Key extends UiPreferenceKey = UiPreferenceKey,
> {
  key: Key;
  revision: number;
  value: UiPreferenceValue<Key>;
}

export const updateUiPreferenceRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    value: z.unknown(),
  })
  .strict();
export type UpdateUiPreferenceRequest = z.infer<
  typeof updateUiPreferenceRequestSchema
>;

function uiPreferenceEntrySchema<Schema extends z.ZodType>(value: Schema) {
  return z.object({ revision: z.number(), value });
}

function uiPreferenceKeyedEntrySchema<Key extends UiPreferenceKey>(key: Key) {
  return z.object({
    key: z.literal(key),
    revision: z.number(),
    value: uiPreferenceDefinitions[key].schema,
  });
}

export const uiPreferencesResponseSchema = z.object({
  preferences: z.object({
    "sidebar.organizationMode": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.organizationMode"].schema,
    ),
    "sidebar.threadGrouping.environment": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.threadGrouping.environment"].schema,
    ),
    "sidebar.chronologicalSort": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.chronologicalSort"].schema,
    ),
    "sidebar.sortDirection": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.sortDirection"].schema,
    ),
    "sidebar.sectionOrder": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.sectionOrder"].schema,
    ),
    "sidebar.manualSectionOrder": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.manualSectionOrder"].schema,
    ),
    "sidebar.machineSectionOrder": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.machineSectionOrder"].schema,
    ),
    "sidebar.hiddenGroups": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.hiddenGroups"].schema,
    ),
    "sidebar.footerOrder": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.footerOrder"].schema,
    ),
    "sidebar.hiddenFooterItems": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.hiddenFooterItems"].schema,
    ),
    "sidebar.pluginPanelOrder": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.pluginPanelOrder"].schema,
    ),
    "sidebar.visiblePluginPanels": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.visiblePluginPanels"].schema,
    ),
    "sidebar.navigationProvider": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.navigationProvider"].schema,
    ),
    "sidebar.threadListProvider": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["sidebar.threadListProvider"].schema,
    ),
    "composer.provider": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["composer.provider"].schema,
    ),
    "threadContextCard.pinned": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["threadContextCard.pinned"].schema,
    ),
    "infoPanel.collapsedSections": uiPreferenceEntrySchema(
      uiPreferenceDefinitions["infoPanel.collapsedSections"].schema,
    ),
  }),
});

export const uiPreferenceResponseSchema = z.union([
  uiPreferenceKeyedEntrySchema("sidebar.organizationMode"),
  uiPreferenceKeyedEntrySchema("sidebar.threadGrouping.environment"),
  uiPreferenceKeyedEntrySchema("sidebar.chronologicalSort"),
  uiPreferenceKeyedEntrySchema("sidebar.sortDirection"),
  uiPreferenceKeyedEntrySchema("sidebar.sectionOrder"),
  uiPreferenceKeyedEntrySchema("sidebar.manualSectionOrder"),
  uiPreferenceKeyedEntrySchema("sidebar.machineSectionOrder"),
  uiPreferenceKeyedEntrySchema("sidebar.hiddenGroups"),
  uiPreferenceKeyedEntrySchema("sidebar.footerOrder"),
  uiPreferenceKeyedEntrySchema("sidebar.hiddenFooterItems"),
  uiPreferenceKeyedEntrySchema("sidebar.pluginPanelOrder"),
  uiPreferenceKeyedEntrySchema("sidebar.visiblePluginPanels"),
  uiPreferenceKeyedEntrySchema("sidebar.navigationProvider"),
  uiPreferenceKeyedEntrySchema("sidebar.threadListProvider"),
  uiPreferenceKeyedEntrySchema("composer.provider"),
  uiPreferenceKeyedEntrySchema("threadContextCard.pinned"),
  uiPreferenceKeyedEntrySchema("infoPanel.collapsedSections"),
]);
