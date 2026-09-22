import { z } from "zod";
import { isPresentationTintColor } from "@bb/domain";

const STRING_MAX_LENGTH = 1_024;
const LIST_MAX_LENGTH = 10_000;

const listItemSchema = z.string().min(1).max(STRING_MAX_LENGTH);
const stringListSchema = z.array(listItemSchema).max(LIST_MAX_LENGTH);

export const organizationModeSchema = z.enum([
  "project",
  "chronological",
  "machine",
]);
export type OrganizationMode = z.infer<typeof organizationModeSchema>;

export const chronologicalSortSchema = z.enum([
  "updated",
  "created",
  "alpha",
  "none",
]);
export type ChronologicalSort = z.infer<typeof chronologicalSortSchema>;

export const sortDirectionSchema = z.enum([
  "default",
  "ascending",
  "descending",
]);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

export const environmentGroupingSchema = z.union([
  z.literal("auto"),
  z.boolean(),
]);
export type EnvironmentGrouping = z.infer<typeof environmentGroupingSchema>;

export const providerIconColorModeSchema = z.enum(["brand", "monochrome"]);
export type ProviderIconColorMode = z.infer<typeof providerIconColorModeSchema>;

const providerIconColorSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isPresentationTintColor, "Expected a CSS color such as #d97757");

export const providerIconColorsSchema = z.record(
  listItemSchema,
  z.object({ light: providerIconColorSchema, dark: providerIconColorSchema }),
);
export type ProviderIconColors = z.infer<typeof providerIconColorsSchema>;

const collapsibleSectionIdSchema = z.enum(["pinned", "threads"]);

const hiddenGroupsSchema = z
  .array(
    z.union([
      z.literal("threads"),
      listItemSchema.regex(/^(project|section|machine):\S+$/),
    ]),
  )
  .max(LIST_MAX_LENGTH)
  .transform((value) => [...new Set(value)]);

function definePreference<Schema extends z.ZodTypeAny>(
  schema: Schema,
  defaultValue: z.infer<Schema>,
  description: string,
  legacyKey: string | null,
) {
  return { schema, defaultValue, description, legacyKey };
}

export const preferenceDefinitions = {
  threadLifecycles: definePreference(
    z
      .array(z.enum(["active", "archived"]))
      .min(1)
      .max(2)
      .refine((value) => new Set(value).size === value.length),
    ["active"],
    "Thread lifecycles shown in the list: active, archived, or both. At least one is required.",
    null,
  ),
  showProviderIcons: definePreference(
    z.boolean(),
    true,
    "Whether each thread row leads with its agent provider's icon.",
    null,
  ),
  providerIconColor: definePreference(
    providerIconColorModeSchema,
    "brand",
    "How provider icons are colored when neither a custom color nor the theme sets one: brand uses each provider's own tint, monochrome matches the row text.",
    null,
  ),
  providerIconColors: definePreference(
    providerIconColorsSchema,
    {},
    "Custom provider icon colors by provider id, each with a light and a dark CSS color. They win over the theme and the color mode.",
    null,
  ),
  organizationMode: definePreference(
    organizationModeSchema,
    "chronological",
    "How the list groups threads: by project, chronologically with custom sections, or by machine.",
    "sidebar.organizationMode",
  ),
  environmentGrouping: definePreference(
    environmentGroupingSchema,
    "auto",
    "Whether sibling threads sharing a worktree collapse into one row. auto groups them in every organization except chronological.",
    "sidebar.threadGrouping.environment",
  ),
  chronologicalSort: definePreference(
    chronologicalSortSchema,
    "updated",
    "Sort field for the chronological organization.",
    "sidebar.chronologicalSort",
  ),
  sortDirection: definePreference(
    sortDirectionSchema,
    "default",
    "Sort direction; default keeps the field's natural direction.",
    "sidebar.sortDirection",
  ),
  sectionOrder: definePreference(
    stringListSchema,
    ["pinned", "projects", "threads"],
    "Top-level order when organized by project.",
    "sidebar.sectionOrder",
  ),
  manualSectionOrder: definePreference(
    stringListSchema,
    ["pinned", "sections", "threads"],
    "Top-level order when organized chronologically.",
    "sidebar.manualSectionOrder",
  ),
  machineSectionOrder: definePreference(
    stringListSchema,
    ["pinned", "machines", "threads"],
    "Top-level order when organized by machine.",
    "sidebar.machineSectionOrder",
  ),
  hiddenGroups: definePreference(
    hiddenGroupsSchema,
    [],
    "Groups moved into More: threads, project:<id>, section:<id>, or machine:<id>.",
    "sidebar.hiddenGroups",
  ),
  collapsedSections: definePreference(
    z.array(collapsibleSectionIdSchema).max(LIST_MAX_LENGTH),
    [],
    "Built-in sections (pinned, threads) that are collapsed.",
    "sidebar.collapsedSections",
  ),
  collapsedProjects: definePreference(
    stringListSchema,
    [],
    "Project ids whose rows are collapsed.",
    "sidebar.collapsedProjects",
  ),
  collapsedThreads: definePreference(
    stringListSchema,
    [],
    "Thread ids whose child threads are collapsed.",
    "sidebar.collapsedThreads",
  ),
  collapsedEnvironments: definePreference(
    stringListSchema,
    [],
    "Environment ids whose rows are collapsed.",
    "sidebar.collapsedEnvironments",
  ),
  collapsedThreadSections: definePreference(
    stringListSchema,
    [],
    "Custom section ids that are collapsed.",
    "sidebar.collapsedThreadSections",
  ),
  collapsedMachines: definePreference(
    stringListSchema,
    [],
    "Machine ids whose rows are collapsed.",
    "sidebar.collapsedMachines",
  ),
} as const;

export type PreferenceKey = keyof typeof preferenceDefinitions;
export const PREFERENCE_KEYS = Object.keys(
  preferenceDefinitions,
) as PreferenceKey[];

export type PreferenceValue<Key extends PreferenceKey> = z.infer<
  (typeof preferenceDefinitions)[Key]["schema"]
>;
export type PreferenceValues = {
  [Key in PreferenceKey]: PreferenceValue<Key>;
};

export function isPreferenceKey(value: string): value is PreferenceKey {
  return Object.hasOwn(preferenceDefinitions, value);
}

export function getPreferenceDefault<Key extends PreferenceKey>(
  key: Key,
): PreferenceValue<Key> {
  return preferenceDefinitions[key].defaultValue as PreferenceValue<Key>;
}

export function defaultPreferences(): PreferenceValues {
  return Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [key, getPreferenceDefault(key)]),
  ) as PreferenceValues;
}

export type PreferenceParseResult<Key extends PreferenceKey> =
  | { success: true; value: PreferenceValue<Key> }
  | { success: false; message: string };

export function parsePreferenceValue<Key extends PreferenceKey>(
  key: Key,
  value: unknown,
): PreferenceParseResult<Key> {
  const schema: z.ZodTypeAny = preferenceDefinitions[key].schema;
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { success: true, value: parsed.data as PreferenceValue<Key> };
  }
  return {
    success: false,
    message: parsed.error.issues.map((issue) => issue.message).join("; "),
  };
}

export function describePreference(key: PreferenceKey): string {
  return preferenceDefinitions[key].description;
}

export const PREFERENCES_CHANGED_CHANNEL = "preferences";

export const preferencesChangedSignalSchema = z
  .object({
    key: z.enum(PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]]),
    value: z.unknown(),
  })
  .strict();
export type PreferencesChangedSignal = z.infer<
  typeof preferencesChangedSignalSchema
>;
