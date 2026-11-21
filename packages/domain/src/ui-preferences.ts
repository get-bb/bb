import { z } from "zod";
import { GIT_PLUGIN_ID } from "./plugin-id.js";

const UI_PREFERENCE_STRING_MAX_LENGTH = 1_024;
const UI_PREFERENCE_LIST_MAX_LENGTH = 10_000;

const sidebarOrganizationModeSchema = z.enum([
  "project",
  "chronological",
  "machine",
]);
export type SidebarOrganizationMode = z.infer<
  typeof sidebarOrganizationModeSchema
>;

const sidebarChronologicalSortSchema = z.enum([
  "updated",
  "created",
  "alpha",
  "none",
]);

const sidebarThreadGroupingSchema = z.union([z.literal("auto"), z.boolean()]);

const uiPreferenceStringSchema = z
  .string()
  .min(1)
  .max(UI_PREFERENCE_STRING_MAX_LENGTH);
const uiPreferenceStringListSchema = z
  .array(uiPreferenceStringSchema)
  .max(UI_PREFERENCE_LIST_MAX_LENGTH);
const UI_PREFERENCE_MAP_MAX_ENTRIES = 1_000;
const pickMapSchema = z
  .record(uiPreferenceStringSchema, uiPreferenceStringSchema)
  .refine(
    (value) => Object.keys(value).length <= UI_PREFERENCE_MAP_MAX_ENTRIES,
    `At most ${UI_PREFERENCE_MAP_MAX_ENTRIES} entries`,
  );
const EXCLUSIVE_PICK_RULE =
  "A pick is <pluginId>/<registrationId>; a pick whose plugin is disabled or uninstalled behaves as __automatic__ and comes back when the plugin does.";
const sidebarHiddenGroupsSchema = z
  .array(uiPreferenceStringSchema.regex(/^(project|section|machine):\S+$/))
  .max(UI_PREFERENCE_LIST_MAX_LENGTH)
  .transform((value) => [...new Set(value)]);

export const UI_PREFERENCE_KEYS = [
  "sidebar.organizationMode",
  "sidebar.threadGrouping.environment",
  "sidebar.chronologicalSort",
  "sidebar.sortDirection",
  "sidebar.sectionOrder",
  "sidebar.manualSectionOrder",
  "sidebar.machineSectionOrder",
  "sidebar.hiddenGroups",
  "sidebar.footerOrder",
  "sidebar.hiddenFooterItems",
  "sidebar.pluginPanelOrder",
  "sidebar.visiblePluginPanels",
  "sidebar.navigationProvider",
  "sidebar.threadListProvider",
  "sidebar.updates.providerCli",
  "sidebar.updates.skipped",
  "composer.provider",
  "diff.provider",
  "sourceCode.provider",
  "threadHeader.titleProvider",
  "fileOpener.byExtension",
  "codeFence.byLanguage",
  "messageDirective.byName",
  "infoPanel.collapsedSections",
  "threadContextCard.pinned",
  "threadContextCard.collapsedSections",
] as const;
export type UiPreferenceKey = (typeof UI_PREFERENCE_KEYS)[number];
const uiPreferenceKeySchema = z.enum(UI_PREFERENCE_KEYS);

export function isUiPreferenceKey(value: string): value is UiPreferenceKey {
  return uiPreferenceKeySchema.safeParse(value).success;
}

interface UiPreferenceDefinition<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: Schema;
  defaultValue: z.infer<Schema>;
  description: string;
}

function defineUiPreference<Schema extends z.ZodTypeAny>(
  schema: Schema,
  defaultValue: z.infer<Schema>,
  description: string,
): UiPreferenceDefinition<Schema> {
  return { schema, defaultValue, description };
}

export const uiPreferenceDefinitions = {
  "sidebar.organizationMode": defineUiPreference(
    sidebarOrganizationModeSchema,
    "chronological",
    "How the sidebar groups threads: by project, Custom (chronological), or by machine. New installations default to Custom; migrated installations with existing work or preferences fall back to By project.",
  ),
  "sidebar.threadGrouping.environment": defineUiPreference(
    sidebarThreadGroupingSchema,
    "auto",
    "Whether sibling threads sharing a worktree environment collapse into one row. auto groups them in every organization mode except Custom.",
  ),
  "sidebar.chronologicalSort": defineUiPreference(
    sidebarChronologicalSortSchema,
    "updated",
    "Sort order for the chronological sidebar organization.",
  ),
  "sidebar.sortDirection": defineUiPreference(
    z.enum(["default", "ascending", "descending"]),
    "default",
    "Sidebar thread sort direction; default preserves the selected field's original direction.",
  ),
  "sidebar.sectionOrder": defineUiPreference(
    uiPreferenceStringListSchema,
    ["pinned", "projects", "threads"],
    "Top-level section order when the sidebar is organized by project.",
  ),
  "sidebar.manualSectionOrder": defineUiPreference(
    uiPreferenceStringListSchema,
    ["pinned", "sections", "threads"],
    "Top-level section order when the sidebar is organized chronologically.",
  ),
  "sidebar.machineSectionOrder": defineUiPreference(
    uiPreferenceStringListSchema,
    ["pinned", "machines", "threads"],
    "Top-level section order when the sidebar is organized by machine.",
  ),
  "sidebar.hiddenGroups": defineUiPreference(
    sidebarHiddenGroupsSchema,
    [],
    "Project, custom section, and machine groups moved into More, using project:<id>, section:<id>, or machine:<id>. Setting this list replaces the hidden groups across all sidebar organizations; reset shows every group.",
  ),
  "sidebar.footerOrder": defineUiPreference(
    uiPreferenceStringListSchema,
    [],
    "Order of built-in and plugin sidebar footer actions.",
  ),
  "sidebar.hiddenFooterItems": defineUiPreference(
    uiPreferenceStringListSchema,
    [],
    "Sidebar footer actions moved into the More menu.",
  ),
  "sidebar.pluginPanelOrder": defineUiPreference(
    uiPreferenceStringListSchema,
    [],
    "Order of sidebar navigation destinations.",
  ),
  "sidebar.visiblePluginPanels": defineUiPreference(
    uiPreferenceStringListSchema.nullable(),
    null,
    "Sidebar navigation destinations shown; null shows every destination.",
  ),
  "sidebar.navigationProvider": defineUiPreference(
    uiPreferenceStringSchema.transform((value) =>
      value === "__builtin__" || value === "navigation/navigation"
        ? "__automatic__"
        : value,
    ),
    "__automatic__",
    "Plugin that draws the sidebar navigation: navigation/rail (the bundled Navigation plugin's icon rail on the sidebar's left edge), navigation/top-list (its labeled rows above the thread list), another plugin key, or __automatic__ for the first navigation from a plugin other than the bundled one, falling back to navigation/rail. Legacy __builtin__ and navigation/navigation resolve to __automatic__, and so does a plugin key whose plugin is disabled or uninstalled.",
  ),
  "sidebar.threadListProvider": defineUiPreference(
    uiPreferenceStringSchema.transform((value) =>
      value === "__builtin__" ? "thread-list/thread-list" : value,
    ),
    "__automatic__",
    "Plugin that renders the sidebar thread list, or __automatic__ for the first installed thread list plugin other than the bundled thread-list/thread-list, falling back to it. Legacy __builtin__ resolves to thread-list/thread-list. A plugin key whose plugin is disabled or uninstalled behaves as __automatic__.",
  ),
  "sidebar.updates.providerCli": defineUiPreference(
    z.boolean(),
    true,
    "Whether agent CLI updates appear in the sidebar update button. false leaves them out of its count, card, and the card's update button; Settings → Updates and bb updates still list them.",
  ),
  "sidebar.updates.skipped": defineUiPreference(
    uiPreferenceStringListSchema,
    [],
    "Updates skipped from the sidebar update button's card. The button stays hidden while every update it would show is in this list and reappears when a new one arrives; [] shows it again. Settings → Updates and bb updates still list skipped updates.",
  ),
  "composer.provider": defineUiPreference(
    uiPreferenceStringSchema,
    "__automatic__",
    "Plugin that draws the composer's input box: a plugin key such as bb--composer/composer, or __automatic__ for the first composer from a plugin you installed, then the bundled Composer plugin. A plugin key whose plugin is disabled or uninstalled behaves as __automatic__. With no composer plugin enabled, no composer is shown.",
  ),
  "diff.provider": defineUiPreference(
    uiPreferenceStringSchema,
    "__automatic__",
    `Plugin that renders file diffs: a plugin key, __builtin__ for bb's own diff, or __automatic__ for the first diff renderer from a plugin you installed (by plugin id), then bb's own (bundled or from bb's official marketplace), then bb's built-in one. ${EXCLUSIVE_PICK_RULE}`,
  ),
  "sourceCode.provider": defineUiPreference(
    uiPreferenceStringSchema,
    "__automatic__",
    `Plugin that renders source files: a plugin key, __builtin__ for bb's own viewer, or __automatic__ for the first source code renderer from a plugin you installed (by plugin id), then bb's own (bundled or from bb's official marketplace), then bb's built-in one. ${EXCLUSIVE_PICK_RULE}`,
  ),
  "threadHeader.titleProvider": defineUiPreference(
    uiPreferenceStringSchema,
    "__automatic__",
    `Plugin that draws the thread title in the thread header: a plugin key, __builtin__ for bb's own title, or __automatic__ for the first header title from a plugin you installed (by plugin id), then bb's own (bundled or from bb's official marketplace), then bb's built-in one. ${EXCLUSIVE_PICK_RULE}`,
  ),
  "fileOpener.byExtension": defineUiPreference(
    pickMapSchema,
    {},
    `File opener per extension, as JSON such as {"md":"simple-notes/docs"}: a plugin key or __builtin__ for bb's preview. An extension that is not listed uses Automatic: the first opener from a plugin you installed (by plugin id), then bb's own (bundled or from bb's official marketplace), then bb's preview. ${EXCLUSIVE_PICK_RULE}`,
  ),
  "codeFence.byLanguage": defineUiPreference(
    pickMapSchema,
    {},
    `Code fence renderer per language, as JSON such as {"bash":"bang-shell/run-code-block"}: a plugin key or __builtin__ for bb's code block. A language that is not listed uses Automatic: the first renderer from a plugin you installed (by plugin id), then bb's own (bundled or from bb's official marketplace), then bb's code block. ${EXCLUSIVE_PICK_RULE}`,
  ),
  "messageDirective.byName": defineUiPreference(
    pickMapSchema,
    {},
    `Message directive renderer per directive name, as JSON such as {"task":"tasks/task"}. A directive that one plugin claims needs no entry. A directive that several plugins claim has no automatic winner: it shows as text with a Choose link until it is listed here. ${EXCLUSIVE_PICK_RULE}`,
  ),
  "threadContextCard.pinned": defineUiPreference(
    z.boolean(),
    true,
    "Whether a thread pane's thread context card stays open beside the transcript when the pane is wide enough; narrow panes always open it from the header.",
  ),
  "threadContextCard.collapsedSections": defineUiPreference(
    uiPreferenceStringListSchema.transform((keys) => [...new Set(keys)]),
    [],
    "Thread context card sections that are folded, as <pluginId>/<sectionId> for plugin sections or bb--core/<sectionId> for bb's own. Sections not listed are open; the list is shared by every thread pane.",
  ),
  "infoPanel.collapsedSections": defineUiPreference(
    uiPreferenceStringListSchema.transform((ids) => [
      ...new Set(
        ids.map((id) =>
          id === "commits"
            ? `${GIT_PLUGIN_ID}/commits`
            : id === "uncommittedChanges"
              ? `${GIT_PLUGIN_ID}/uncommitted-changes`
              : id,
        ),
      ),
    ]),
    [],
    "Thread Info panel section ids that are collapsed, such as forks, threadStorage, or <pluginId>/<sectionId> for plugin sections like bb--git/commits and bb--git/uncommitted-changes. Legacy commits and uncommittedChanges resolve to the Git plugin's sections.",
  ),
} as const satisfies Record<UiPreferenceKey, UiPreferenceDefinition>;

export type UiPreferenceValue<Key extends UiPreferenceKey> = z.infer<
  (typeof uiPreferenceDefinitions)[Key]["schema"]
>;
export type UiPreferenceValues = {
  [Key in UiPreferenceKey]: UiPreferenceValue<Key>;
};

export function getUiPreferenceDefault<Key extends UiPreferenceKey>(
  key: Key,
): UiPreferenceValue<Key> {
  return uiPreferenceDefinitions[key].defaultValue as UiPreferenceValue<Key>;
}

export const defaultUiPreferences: UiPreferenceValues = Object.fromEntries(
  UI_PREFERENCE_KEYS.map((key) => [key, getUiPreferenceDefault(key)]),
) as UiPreferenceValues;

export type UiPreferenceParseResult<Key extends UiPreferenceKey> =
  | { success: true; value: UiPreferenceValue<Key> }
  | { success: false; message: string };

export function parseUiPreferenceValue<Key extends UiPreferenceKey>(
  key: Key,
  value: unknown,
): UiPreferenceParseResult<Key> {
  const schema: z.ZodTypeAny = uiPreferenceDefinitions[key].schema;
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { success: true, value: parsed.data as UiPreferenceValue<Key> };
  }
  return {
    success: false,
    message: parsed.error.issues.map((issue) => issue.message).join("; "),
  };
}

export function describeUiPreference(key: UiPreferenceKey): string {
  return uiPreferenceDefinitions[key].description;
}

export interface UiPreferenceEntry<
  Key extends UiPreferenceKey = UiPreferenceKey,
> {
  revision: number;
  value: UiPreferenceValue<Key>;
}

export type UiPreferenceEntries = {
  [Key in UiPreferenceKey]: UiPreferenceEntry<Key>;
};
