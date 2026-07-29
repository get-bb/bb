import { jsonValueSchema } from "@bb/domain";
import { z } from "zod";

export const pluginRuntimeStatusSchema = z.enum([
  "running",
  "error",
  "incompatible",
  "missing",
  "disabled",
  "degraded",
  "needs-configuration",
]);
export type PluginRuntimeStatus = z.infer<typeof pluginRuntimeStatusSchema>;

export const pluginUpdateOutcomeSchema = z.enum([
  "current",
  "update-available",
  "pinned",
  "incompatible",
  "unavailable",
]);
export type PluginUpdateOutcome = z.infer<typeof pluginUpdateOutcomeSchema>;

export const pluginResolvedVersionSchema = z.object({
  version: z.string(),
  display: z.string(),
});
export type PluginResolvedVersion = z.infer<typeof pluginResolvedVersionSchema>;

export const pluginUpdateCheckEntrySchema = z.object({
  id: z.string(),
  outcome: pluginUpdateOutcomeSchema,
  devMode: z.literal(true).optional(),
  installed: pluginResolvedVersionSchema,
  candidate: pluginResolvedVersionSchema.optional(),
  blocked: z
    .object({ version: z.string(), reasons: z.array(z.string()) })
    .optional(),
  detail: z.string().optional(),
});
export type PluginUpdateCheckEntry = z.infer<
  typeof pluginUpdateCheckEntrySchema
>;

export const pluginUpdateCheckRequestSchema = z
  .object({ id: z.string().min(1).optional() })
  .strict();
export type PluginUpdateCheckRequest = z.infer<
  typeof pluginUpdateCheckRequestSchema
>;

export const pluginUpdateCheckResponseSchema = z.object({
  results: z.array(pluginUpdateCheckEntrySchema),
});
export type PluginUpdateCheckResponse = z.infer<
  typeof pluginUpdateCheckResponseSchema
>;

export const pluginApplyUpdateRequestSchema = z.object({}).strict();
export type PluginApplyUpdateRequest = z.infer<
  typeof pluginApplyUpdateRequestSchema
>;

export const pluginApplyUpdateResultSchema = z.object({
  applied: z.boolean(),
  from: pluginResolvedVersionSchema,
  to: pluginResolvedVersionSchema.optional(),
  outcome: z.enum(["current", "updated", "rolled-back"]),
  detail: z.string().optional(),
});
export type PluginApplyUpdateResult = z.infer<
  typeof pluginApplyUpdateResultSchema
>;

export const pluginSourceHistoryEntrySchema = z.object({
  version: z.string(),
  activatedAt: z.number(),
});
export type PluginSourceHistoryEntry = z.infer<
  typeof pluginSourceHistoryEntrySchema
>;

export const pluginSourceDetailSchema = z.object({
  requested: z.string(),
  resolved: z.string(),
  integrity: z.string().optional(),
  registry: z.string().optional(),
  engines: z.object({
    bb: z.string().optional(),
    bbPluginSdk: z.string().optional(),
  }),
  installedAt: z.number().optional(),
  history: z.array(pluginSourceHistoryEntrySchema),
});
export type PluginSourceDetail = z.infer<typeof pluginSourceDetailSchema>;

export const pluginUpdateStateSchema = z.object({
  outcome: pluginUpdateOutcomeSchema.optional(),
  availableVersion: z.string().optional(),
  blockedVersion: z.string().optional(),
  blockedReasons: z.array(z.string()).optional(),
  lastCheckAt: z.number().optional(),
  lastFailure: z
    .object({ version: z.string(), at: z.number(), detail: z.string() })
    .optional(),
});
export type PluginUpdateState = z.infer<typeof pluginUpdateStateSchema>;

export const pluginHandlerStatsSchema = z.object({
  count: z.number(),
  totalMs: z.number(),
  maxMs: z.number(),
  errorCount: z.number(),
});
export type PluginHandlerStats = z.infer<typeof pluginHandlerStatsSchema>;

export const pluginServiceEntrySchema = z.object({
  name: z.string(),
  state: z.enum(["running", "backoff", "stopped"]),
});
export type PluginServiceEntry = z.infer<typeof pluginServiceEntrySchema>;

export const pluginScheduleEntrySchema = z.object({
  name: z.string(),
  cron: z.string(),
  nextRunAt: z.number(),
  lastRunAt: z.number().nullable(),
  lastStatus: z.enum(["running", "ok", "error"]).nullable(),
  lastError: z.string().nullable(),
});

export const pluginAppStateSchema = z.object({
  hasApp: z.boolean(),
  bundle: z
    .object({
      jsUrl: z.string(),
      cssUrl: z.string().nullable(),
      hash: z.string(),
      sdkMajor: z.number(),
      sdkVersion: z.string(),
      compatible: z.boolean(),
    })
    .nullable(),
});

/**
 * A user-recognizable thing a plugin contributes to bb, as shown in the plugin
 * detail "Includes" section. These are product facts, not server internals:
 * RPC methods, HTTP routes, event handlers, and databases are deliberately
 * absent.
 *
 * `skill` and `theme` are manifest-declared, so they stay accurate while the
 * plugin is disabled. `agent-tool` and `thread-integration` are only observable
 * on a loaded plugin, so a disabled plugin reports none of them and the detail
 * page says so rather than implying it has none.
 */
export const pluginCapabilitySchema = z.object({
  kind: z.enum(["skill", "theme", "agent-tool", "thread-integration"]),
  id: z.string(),
  label: z.string(),
  detail: z.string().nullable(),
});
export type PluginCapability = z.infer<typeof pluginCapabilitySchema>;

/** Every capability a plugin contributes, used to render plugin Includes. */
export const pluginCapabilitySummarySchema = z.array(pluginCapabilitySchema);
export type PluginCapabilitySummary = z.infer<
  typeof pluginCapabilitySummarySchema
>;

export const installedPluginSchema = z.object({
  id: z.string(),
  source: z.string(),
  rootDir: z.string(),
  version: z.string(),
  provenance: z.enum(["builtin", "direct", "catalog"]),
  isOrphanedBuiltin: z.boolean(),
  catalogEntryId: z.string().optional(),
  sourceDisplay: z.string(),
  updateState: pluginUpdateStateSchema,
  enabled: z.boolean(),
  description: z.string().nullable(),
  name: z.string().nullable(),
  icon: z.string().nullable(),
  /** Hashed URL when branding.icon declares a plugin-owned compact SVG. */
  iconUrl: z.string().nullable(),
  status: pluginRuntimeStatusSchema,
  statusDetail: z.string().nullable(),
  handlerStats: pluginHandlerStatsSchema,
  services: z.array(pluginServiceEntrySchema),
  schedules: z.array(pluginScheduleEntrySchema),
  cliCommand: z.object({ name: z.string(), summary: z.string() }).nullable(),
  capabilities: pluginCapabilitySummarySchema.default([]),
  hasSettings: z.boolean(),
  app: pluginAppStateSchema,
  logoUrl: z.string().nullable(),
  logoDarkUrl: z.string().nullable(),
});
export type InstalledPlugin = z.infer<typeof installedPluginSchema>;

export const pluginListResponseSchema = z.object({
  enabled: z.boolean(),
  plugins: z.array(installedPluginSchema),
});
export type PluginListResponse = z.infer<typeof pluginListResponseSchema>;

export const pluginInstallSourceRequestSchema = z
  .object({ source: z.string().min(1) })
  .strict();
export type PluginInstallSourceRequest = z.infer<
  typeof pluginInstallSourceRequestSchema
>;

export const pluginCatalogInstallRequestSchema = z
  .object({ entryId: z.string().min(1) })
  .strict();
export type PluginCatalogInstallRequest = z.infer<
  typeof pluginCatalogInstallRequestSchema
>;

export const pluginInstallRequestSchema = pluginInstallSourceRequestSchema;
export type PluginInstallRequest = z.infer<typeof pluginInstallRequestSchema>;

export const pluginMutationResponseSchema = z.object({
  ok: z.literal(true),
  plugin: installedPluginSchema,
});
export type PluginMutationResponse = z.infer<
  typeof pluginMutationResponseSchema
>;

export const pluginInstallResponseSchema = pluginMutationResponseSchema;
export type PluginInstallResponse = PluginMutationResponse;

export const pluginReloadResponseSchema = z.object({
  ok: z.literal(true),
  plugins: z.array(installedPluginSchema),
});
export type PluginReloadResponse = z.infer<typeof pluginReloadResponseSchema>;

export const pluginRemoveResponseSchema = z.object({ ok: z.literal(true) });
export type PluginRemoveResponse = z.infer<typeof pluginRemoveResponseSchema>;

const pluginSettingBaseSchema = {
  label: z.string().min(1),
  description: z.string().min(1).optional(),
};

export const pluginSettingDescriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...pluginSettingBaseSchema,
      type: z.literal("string"),
      secret: z.literal(true).optional(),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...pluginSettingBaseSchema,
      type: z.literal("boolean"),
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...pluginSettingBaseSchema,
      type: z.literal("select"),
      options: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...pluginSettingBaseSchema,
      type: z.literal("project"),
      default: z.string().optional(),
    })
    .strict(),
]);
export type PluginSettingDescriptor = z.infer<
  typeof pluginSettingDescriptorSchema
>;

export const pluginSettingsResponseSchema = z.object({
  ok: z.literal(true),
  schema: z.record(z.string(), pluginSettingDescriptorSchema),
  values: z.record(z.string(), jsonValueSchema),
});
export type PluginSettingsResponse = z.infer<
  typeof pluginSettingsResponseSchema
>;

export const pluginSettingsUpdateRequestSchema = z
  .object({ values: z.record(z.string(), jsonValueSchema) })
  .strict();
export type PluginSettingsUpdateRequest = z.infer<
  typeof pluginSettingsUpdateRequestSchema
>;

export const pluginTokenRequestSchema = z
  .object({ rotate: z.boolean().optional().default(false) })
  .strict();
export type PluginTokenRequest = z.infer<typeof pluginTokenRequestSchema>;

export const pluginTokenResponseSchema = z.object({
  ok: z.literal(true),
  token: z.string(),
});
export type PluginTokenResponse = z.infer<typeof pluginTokenResponseSchema>;

export const pluginCatalogStatusSchema = z.object({
  pluginCount: z.number(),
});
export type PluginCatalogStatus = z.infer<typeof pluginCatalogStatusSchema>;

export const pluginCatalogStatusResponseSchema = z.object({
  catalog: pluginCatalogStatusSchema,
});
export type PluginCatalogStatusResponse = z.infer<
  typeof pluginCatalogStatusResponseSchema
>;

export const pluginCatalogSearchResultSchema = z.object({
  entryId: z.string(),
  pluginId: z.string(),
  displayName: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  category: z.string(),
  source: z.string(),
  installed: z.boolean(),
  compatible: z.boolean(),
  incompatibleReason: z.string().nullable(),
});
export type PluginCatalogSearchResult = z.infer<
  typeof pluginCatalogSearchResultSchema
>;

export const pluginCatalogSearchResponseSchema = z.object({
  results: z.array(pluginCatalogSearchResultSchema),
});
export type PluginCatalogSearchResponse = z.infer<
  typeof pluginCatalogSearchResponseSchema
>;
