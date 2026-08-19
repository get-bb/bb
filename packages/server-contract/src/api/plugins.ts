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
  /** Repository-relative plugin directory; absent for a root install. */
  subdirectory: z.string().optional(),
  /** Semver range over git tags; absent when the source names one ref. */
  range: z.string().optional(),
  /** Tag prefix the range matches; absent for repository-wide `vX.Y.Z` tags. */
  tagPrefix: z.string().optional(),
  /** Git tag the range resolved to; absent when the source names one ref. */
  resolvedTag: z.string().optional(),
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
  /** Actionable reason when bb could not verify the update source. */
  detail: z.string().optional(),
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
      jsBytes: z.number().int().nonnegative(),
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
  /** Marketplace that listed the entry; present only on catalog installs. */
  catalogMarketplaceName: z.string().optional(),
  /**
   * Publisher badge: `BB Official` for a bundled plugin, the listing
   * marketplace's display name for a catalog install, and null for a plugin
   * the user added from a source, which has no publisher bb can vouch for.
   * Servers before bb-app 0.38.0 do not send it; a client that reads such a
   * response treats the plugin as unlabeled instead of failing after the
   * server already applied the change.
   */
  publisherLabel: z.string().nullable().default(null),
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
  plugins: z.array(installedPluginSchema),
});
export type PluginListResponse = z.infer<typeof pluginListResponseSchema>;

/**
 * Which plugin of a source an install selects. A repository can hold several
 * plugins, indexed by a `.bb/plugins.json` collection manifest: "subdirectory"
 * is the primitive, "entry" resolves a manifest entry name, and "root" installs
 * the source directory itself.
 */
export const pluginSourceSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("root") }).strict(),
  z
    .object({ kind: z.literal("subdirectory"), path: z.string().min(1) })
    .strict(),
  z.object({ kind: z.literal("entry"), name: z.string().min(1) }).strict(),
]);
export type PluginSourceSelection = z.infer<typeof pluginSourceSelectionSchema>;

export const ROOT_PLUGIN_SOURCE_SELECTION: PluginSourceSelection = {
  kind: "root",
};

export const pluginInstallSourceRequestSchema = z
  .object({
    source: z.string().min(1),
    selection: pluginSourceSelectionSchema.default(
      ROOT_PLUGIN_SOURCE_SELECTION,
    ),
  })
  .strict();
export type PluginInstallSourceRequest = z.infer<
  typeof pluginInstallSourceRequestSchema
>;

/** Marketplace names and entry ids share one shape: lowercase kebab-case. */
export const PLUGIN_MARKETPLACE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

/**
 * Reserved name of the marketplace BB curates. It cannot be added, cannot be
 * removed, and is the only marketplace whose listings BB reviews.
 */
export const CURATED_PLUGIN_MARKETPLACE_NAME = "bb-community";

export const pluginMarketplaceNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(PLUGIN_MARKETPLACE_NAME_PATTERN);

export const pluginCatalogInstallRequestSchema = z
  .object({
    entryId: z.string().min(1),
    /**
     * Which marketplace lists the entry. Omitted resolves across every
     * marketplace: exactly one match installs, none falls back to the bundled
     * official plugin of that name, and several are refused as ambiguous.
     */
    marketplace: pluginMarketplaceNameSchema.optional(),
    /** Source facts the user confirmed for a third-party marketplace entry. */
    confirmedSource: z.lazy(() => pluginCatalogResolvedSourceSchema).optional(),
  })
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
  includedPluginCount: z.number(),
  optionalPluginCount: z.number(),
});
export type PluginCatalogStatus = z.infer<typeof pluginCatalogStatusSchema>;

export const pluginCatalogStatusResponseSchema = z.object({
  catalog: pluginCatalogStatusSchema,
});
export type PluginCatalogStatusResponse = z.infer<
  typeof pluginCatalogStatusResponseSchema
>;

/** Display metadata of the person or organization behind a catalog entry. */
export const pluginCatalogAuthorSchema = z.object({
  name: z.string(),
  /** The author's own URL, or their GitHub profile; null when neither is listed. */
  url: z.string().nullable(),
});
export type PluginCatalogAuthor = z.infer<typeof pluginCatalogAuthorSchema>;

export const pluginCatalogSearchResultSchema = z.object({
  entryId: z.string(),
  pluginId: z.string(),
  displayName: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  /**
   * BB-hosted URL of a cached marketplace icon image, or null when the entry
   * names a host icon. The app never requests the marketplace's own URL.
   */
  iconUrl: z.string().nullable(),
  /**
   * Whether the app masks `iconUrl` with the surrounding text color, as it
   * does a plugin's own compact `branding.icon`, instead of showing the
   * image's own colors. True for bundled compact icons and for catalog SVGs;
   * false for PNG and WebP. Servers before bb-app 0.40.0 do not send it;
   * those icons render untinted.
   */
  iconTinted: z.boolean().default(false),
  category: z.string(),
  source: z.string(),
  /**
   * Where a person can read the plugin's code before an install: the git
   * repository of a git-sourced entry, or the public npm package page of an
   * npm-sourced entry on the default registry. Null for plugins bundled with
   * the app and for packages on a private registry. Older servers do not
   * send it; those entries show no link.
   */
  repositoryUrl: z.string().nullable().default(null),
  /** Marketplace that lists the entry; plugins bundled with the app use `bb-community`. */
  marketplace: z.string(),
  marketplaceDisplayName: z.string(),
  /**
   * Stable identity of the publisher, for grouping. A marketplace names itself,
   * so grouping on the label alone let a third-party marketplace merge its
   * entries into another publisher's group by copying its display name.
   * `builtin` for plugins bundled with the app; otherwise the marketplace name.
   */
  publisherKey: z.string(),
  /**
   * Publisher badge for the entry: the listing marketplace's display name, or
   * `BB Official` for plugins bundled with the app. It is separate from
   * `marketplaceDisplayName` because bundled plugins are grouped under the
   * curated marketplace but are not published through it.
   */
  publisherLabel: z.string(),
  /** Whether the listing marketplace is the reserved `bb-community` one. */
  official: z.boolean(),
  /** Null for plugins bundled with the app, which list no separate author. */
  author: pluginCatalogAuthorSchema.nullable(),
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

/**
 * The true source an install will run against, resolved before anything runs.
 * Both kinds report the exact artifact they resolve to right now — a commit
 * for git, a version and its integrity for npm — so a range or tag install is
 * confirmed against the exact code it will fetch.
 */
export const pluginCatalogResolvedSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("npm"),
      package: z.string(),
      /** Version range the listing tracks; absent when it names a dist-tag. */
      range: z.string().optional(),
      /** npm dist-tag the listing tracks; absent when it names a range. */
      tag: z.string().optional(),
      /** Registry override the listing pins; absent uses bb's default. */
      registry: z.string().optional(),
      /** Exact version the range or tag resolves to now; absent when unresolved. */
      resolvedVersion: z.string().optional(),
      /**
       * Subresource integrity the registry publishes for that version; absent
       * when the registry omits it, which bb reports rather than invents.
       */
      resolvedIntegrity: z.string().optional(),
      /** Why bb could not resolve the version; absent once it resolved. */
      unresolvedReason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("git"),
      url: z.string(),
      /** Repository directory the entry lists; absent installs the root. */
      subdir: z.string().optional(),
      /** The single ref the listing pins; absent when it lists a range. */
      ref: z.string().optional(),
      /** Semver range over release tags; absent when the listing pins a ref. */
      range: z.string().optional(),
      /** Tag prefix the range matches; absent for repository-wide `vX.Y.Z` tags. */
      tagPrefix: z.string().optional(),
      /** Release tag the range resolves to now; absent when unresolved. */
      resolvedTag: z.string().optional(),
      /** Commit the ref or resolved tag points at now; absent when unresolved. */
      resolvedCommit: z.string().optional(),
      /** Why bb could not resolve the source; absent once it resolved. */
      unresolvedReason: z.string().optional(),
    })
    .strict(),
]);
export type PluginCatalogResolvedSource = z.infer<
  typeof pluginCatalogResolvedSourceSchema
>;

/**
 * What `POST /plugin-catalog/install` would do with the same arguments, shown
 * to the user before anything runs. `bundled` entries install from the copy
 * inside the app; `marketplace` entries install from their listed source.
 */
export const pluginCatalogInstallPlanSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bundled"),
    entryId: z.string(),
    pluginId: z.string(),
    displayName: z.string(),
    source: z.string(),
    compatible: z.boolean(),
    incompatibleReason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("marketplace"),
    entryId: z.string(),
    pluginId: z.string(),
    displayName: z.string(),
    marketplace: z.string(),
    marketplaceDisplayName: z.string(),
    official: z.boolean(),
    author: pluginCatalogAuthorSchema,
    /** Install-pipeline spec bb runs for this entry. */
    source: z.string(),
    resolvedSource: pluginCatalogResolvedSourceSchema,
    compatible: z.boolean(),
    incompatibleReason: z.string().nullable(),
  }),
]);
export type PluginCatalogInstallPlan = z.infer<
  typeof pluginCatalogInstallPlanSchema
>;

export const pluginCatalogInstallPlanResponseSchema = z.object({
  plan: pluginCatalogInstallPlanSchema,
});
export type PluginCatalogInstallPlanResponse = z.infer<
  typeof pluginCatalogInstallPlanResponseSchema
>;

export const pluginMarketplaceSourceKindSchema = z.enum([
  "https",
  "git",
  "path",
]);
export type PluginMarketplaceSourceKind = z.infer<
  typeof pluginMarketplaceSourceKindSchema
>;

export const pluginMarketplaceSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  /** The reserved `bb-community` marketplace, which cannot be removed. */
  official: z.boolean(),
  sourceKind: pluginMarketplaceSourceKindSchema,
  /** Canonical spec that re-adds this marketplace. */
  source: z.string(),
  /** Commit the last successful git refresh read; null for other kinds. */
  resolvedCommit: z.string().nullable(),
  entryCount: z.number(),
  lastRefreshAt: z.number().nullable(),
  lastAttemptAt: z.number().nullable(),
  lastError: z.string().nullable(),
});
export type PluginMarketplace = z.infer<typeof pluginMarketplaceSchema>;

export const pluginMarketplaceListResponseSchema = z.object({
  marketplaces: z.array(pluginMarketplaceSchema),
});
export type PluginMarketplaceListResponse = z.infer<
  typeof pluginMarketplaceListResponseSchema
>;

export const pluginMarketplaceAddRequestSchema = z
  .object({
    /**
     * `https://<manifest-url>`, `git:<url>[@<ref>]`, or `path:<directory>`.
     * The manifest's own `name` becomes the marketplace's identity.
     */
    source: z.string().min(1),
  })
  .strict();
export type PluginMarketplaceAddRequest = z.infer<
  typeof pluginMarketplaceAddRequestSchema
>;

export const pluginMarketplaceMutationResponseSchema = z.object({
  ok: z.literal(true),
  marketplace: pluginMarketplaceSchema,
});
export type PluginMarketplaceMutationResponse = z.infer<
  typeof pluginMarketplaceMutationResponseSchema
>;

export const pluginMarketplaceRemoveResponseSchema = z.object({
  ok: z.literal(true),
  /** Installs whose provenance became `direct`; they keep running as before. */
  convertedPluginIds: z.array(z.string()),
});
export type PluginMarketplaceRemoveResponse = z.infer<
  typeof pluginMarketplaceRemoveResponseSchema
>;

export const pluginMarketplaceRefreshRequestSchema = z
  .object({
    /** One marketplace to refresh; omitted refreshes every one of them. */
    name: pluginMarketplaceNameSchema.optional(),
  })
  .strict();
export type PluginMarketplaceRefreshRequest = z.infer<
  typeof pluginMarketplaceRefreshRequestSchema
>;

export const pluginMarketplaceRefreshResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  /** State after the attempt; a failure keeps the last-known-good catalog. */
  marketplace: pluginMarketplaceSchema,
});
export type PluginMarketplaceRefreshResult = z.infer<
  typeof pluginMarketplaceRefreshResultSchema
>;

export const pluginMarketplaceRefreshResponseSchema = z.object({
  results: z.array(pluginMarketplaceRefreshResultSchema),
});
export type PluginMarketplaceRefreshResponse = z.infer<
  typeof pluginMarketplaceRefreshResponseSchema
>;
