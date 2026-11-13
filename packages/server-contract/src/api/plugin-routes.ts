import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
  optionalQueryRequest,
} from "@bb/hono-typed-routes";
import { z } from "zod";
import {
  installedPluginSchema,
  pluginApplyUpdateRequestSchema,
  pluginApplyUpdateResultSchema,
  pluginCachePruneRequestSchema,
  pluginCachePruneResponseSchema,
  pluginCatalogInstallPlanResponseSchema,
  pluginCatalogInstallRequestSchema,
  pluginCatalogSearchResponseSchema,
  pluginCatalogStatusResponseSchema,
  pluginInstallJobListResponseSchema,
  pluginInstallJobResponseSchema,
  pluginInstallJobStartResponseSchema,
  pluginInstallRequestSchema,
  pluginListResponseSchema,
  pluginMarketplaceAddRequestSchema,
  pluginMarketplaceListResponseSchema,
  pluginMarketplaceMutationResponseSchema,
  pluginMarketplaceRefreshRequestSchema,
  pluginMarketplaceRefreshResponseSchema,
  pluginMarketplaceRemoveResponseSchema,
  pluginReloadResponseSchema,
  pluginRemoveResponseSchema,
  pluginRpcDiscoveryQuerySchema,
  pluginRpcDiscoveryResponseSchema,
  pluginSafeModeRequestSchema,
  pluginSafeModeResponseSchema,
  pluginSafeModeUpdateResponseSchema,
  pluginSettingsResponseSchema,
  pluginSettingsUpdateRequestSchema,
  pluginSourceDetailSchema,
  pluginTokenRequestSchema,
  pluginTokenResponseSchema,
  pluginUpdateCheckRequestSchema,
  pluginUpdateCheckResponseSchema,
  pluginUpdateJobListResponseSchema,
  pluginUpdateJobResponseSchema,
} from "./plugins.js";
import {
  registrySkillDetailSchema,
  registrySkillEntriesRequestSchema,
  registrySkillEntriesResponseSchema,
  registrySkillInstallJobResponseSchema,
  registrySkillInstallRequestSchema,
  registrySkillInstallResponseSchema,
  registrySkillSchema,
  registrySkillsPageSchema,
} from "./skills.js";

const pluginMentionTriggerSchema = z.enum(["@", "#", "$", "!", "~"]);

export const pluginContributionsResponseSchema = z.object({
  cliCommands: z.array(
    z.object({
      pluginId: z.string(),
      name: z.string(),
      summary: z.string(),
      commands: z.array(
        z.object({ name: z.string(), summary: z.string(), usage: z.string() }),
      ),
      rendersHelp: z.boolean(),
    }),
  ),
  mentionProviders: z.array(
    z.object({
      pluginId: z.string(),
      id: z.string(),
      label: z.string(),
      triggers: z.array(pluginMentionTriggerSchema).readonly(),
    }),
  ),
});
export type PluginContributionsResponse = z.infer<
  typeof pluginContributionsResponseSchema
>;

export const pluginMentionSearchQuerySchema = z.object({
  q: z.string().optional(),
  projectId: z.string().optional(),
  threadId: z.string().optional(),
  trigger: z.string().optional(),
});
export type PluginMentionSearchQuery = z.infer<
  typeof pluginMentionSearchQuerySchema
>;

export const pluginMentionSearchResponseSchema = z.object({
  ok: z.literal(true),
  groups: z.array(
    z.object({
      pluginId: z.string(),
      providerId: z.string(),
      label: z.string(),
      items: z.array(
        z.object({
          itemId: z.string(),
          title: z.string(),
          subtitle: z.string().nullable(),
          icon: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type PluginMentionSearchResponse = z.infer<
  typeof pluginMentionSearchResponseSchema
>;

export const pluginSettingsViewResponseSchema =
  pluginSettingsResponseSchema.extend({
    values: z.record(z.string(), z.unknown()),
  });
export type PluginSettingsViewResponse = z.infer<
  typeof pluginSettingsViewResponseSchema
>;

export const pluginLogsQuerySchema = z.object({ tail: z.string().optional() });
export type PluginLogsQuery = z.infer<typeof pluginLogsQuerySchema>;

export const pluginLogsResponseSchema = z.object({
  ok: z.literal(true),
  lines: z.array(z.string()),
});
export type PluginLogsResponse = z.infer<typeof pluginLogsResponseSchema>;

export const pluginReloadQuerySchema = z.object({ id: z.string().optional() });
export type PluginReloadQuery = z.infer<typeof pluginReloadQuerySchema>;

export const pluginEnableResponseSchema = z.object({
  ok: z.literal(true),
  plugin: installedPluginSchema,
});
export type PluginEnableResponse = z.infer<typeof pluginEnableResponseSchema>;

export const pluginInstallResultSchema = z.union([
  pluginInstallJobStartResponseSchema,
  pluginEnableResponseSchema,
]);
export type PluginInstallResult = z.infer<typeof pluginInstallResultSchema>;

export const pluginApplyUpdateResponseSchema = z.union([
  pluginUpdateJobResponseSchema,
  pluginApplyUpdateResultSchema,
]);
export type PluginApplyUpdateResponse = z.infer<
  typeof pluginApplyUpdateResponseSchema
>;

export const pluginCatalogSearchQuerySchema = z.object({
  q: z.string().optional(),
});
export type PluginCatalogSearchQuery = z.infer<
  typeof pluginCatalogSearchQuerySchema
>;

export const pluginCatalogInstallPlanQuerySchema = z.object({
  entryId: z.string().optional(),
  marketplace: z.string().optional(),
});
export type PluginCatalogInstallPlanQuery = z.infer<
  typeof pluginCatalogInstallPlanQuerySchema
>;

export const registrySkillListQuerySchema = z.object({
  q: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional(),
});
export type RegistrySkillListQuery = z.infer<
  typeof registrySkillListQuerySchema
>;

export const registrySkillEntryQuerySchema = z.object({
  id: z.string().optional(),
});
export type RegistrySkillEntryQuery = z.infer<
  typeof registrySkillEntryQuerySchema
>;

export const registryRepositoryStarsQuerySchema = z.object({
  source: z.string().optional(),
});
export type RegistryRepositoryStarsQuery = z.infer<
  typeof registryRepositoryStarsQuerySchema
>;

export const registryRepositoryStarsResponseSchema = z.object({
  stars: z.number(),
});
export type RegistryRepositoryStarsResponse = z.infer<
  typeof registryRepositoryStarsResponseSchema
>;

export const registrySkillDetailQuerySchema = z.object({
  source: z.string().optional(),
  skillId: z.string().optional(),
});
export type RegistrySkillDetailQuery = z.infer<
  typeof registrySkillDetailQuerySchema
>;

type Infer<Schema extends z.ZodType> = z.infer<Schema>;

export const pluginManagementRoutes = {
  plugins: {
    discoverRpc: defineRoute({
      path: "/plugins/rpc",
      method: "get",
      request: optionalQueryRequest(pluginRpcDiscoveryQuerySchema),
      response: jsonResponse<Infer<typeof pluginRpcDiscoveryResponseSchema>>(),
    }),
    list: defineRoute({
      path: "/plugins",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginListResponseSchema>>(),
    }),
    contributions: defineRoute({
      path: "/plugins/contributions",
      method: "get",
      request: noRequest(),
      response: jsonResponse<PluginContributionsResponse>(),
    }),
    searchMentions: defineRoute({
      path: "/plugins/mentions/search",
      method: "get",
      request: optionalQueryRequest(pluginMentionSearchQuerySchema),
      response: jsonResponse<PluginMentionSearchResponse>(),
    }),
    logs: defineRoute({
      path: "/plugins/:id/logs",
      method: "get",
      request: optionalQueryRequest(pluginLogsQuerySchema),
      response: jsonResponse<PluginLogsResponse>(),
    }),
    checkUpdates: defineRoute({
      path: "/plugins/updates/check",
      method: "post",
      request: jsonRequest(pluginUpdateCheckRequestSchema),
      response: jsonResponse<Infer<typeof pluginUpdateCheckResponseSchema>>(),
    }),
    updates: defineRoute({
      path: "/plugins/updates",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginUpdateCheckResponseSchema>>(),
    }),
    pruneCache: defineRoute({
      path: "/plugins/cache/prune",
      method: "post",
      request: jsonRequest(pluginCachePruneRequestSchema),
      response: jsonResponse<Infer<typeof pluginCachePruneResponseSchema>>(),
    }),
    applyUpdate: defineRoute({
      path: "/plugins/:id/update",
      method: "post",
      request: jsonRequest(pluginApplyUpdateRequestSchema),
      response: [
        jsonResponse<Infer<typeof pluginApplyUpdateResultSchema>>(),
        jsonResponse<Infer<typeof pluginUpdateJobResponseSchema>, 202>({
          status: 202,
        }),
      ],
    }),
    install: defineRoute({
      path: "/plugins/install",
      method: "post",
      request: jsonRequest(pluginInstallRequestSchema),
      response: [
        jsonResponse<PluginEnableResponse>(),
        jsonResponse<Infer<typeof pluginInstallJobStartResponseSchema>, 202>({
          status: 202,
        }),
      ],
    }),
    source: defineRoute({
      path: "/plugins/:id/source",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginSourceDetailSchema>>(),
    }),
    reload: defineRoute({
      path: "/plugins/reload",
      method: "post",
      request: optionalQueryRequest(pluginReloadQuerySchema),
      response: jsonResponse<Infer<typeof pluginReloadResponseSchema>>(),
    }),
    safeMode: defineRoute({
      path: "/plugins/safe-mode",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginSafeModeResponseSchema>>(),
    }),
    setSafeMode: defineRoute({
      path: "/plugins/safe-mode",
      method: "put",
      request: jsonRequest(pluginSafeModeRequestSchema),
      response:
        jsonResponse<Infer<typeof pluginSafeModeUpdateResponseSchema>>(),
    }),
    enable: defineRoute({
      path: "/plugins/:id/enable",
      method: "post",
      request: noRequest(),
      response: jsonResponse<PluginEnableResponse>(),
    }),
    disable: defineRoute({
      path: "/plugins/:id/disable",
      method: "post",
      request: noRequest(),
      response: jsonResponse<PluginEnableResponse>(),
    }),
    settings: defineRoute({
      path: "/plugins/:id/settings",
      method: "get",
      request: noRequest(),
      response: jsonResponse<PluginSettingsViewResponse>(),
    }),
    updateSettings: defineRoute({
      path: "/plugins/:id/settings",
      method: "put",
      request: jsonRequest(pluginSettingsUpdateRequestSchema),
      response: jsonResponse<PluginSettingsViewResponse>(),
    }),
    remove: defineRoute({
      path: "/plugins/:id",
      method: "delete",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginRemoveResponseSchema>>(),
    }),
    token: defineRoute({
      path: "/plugins/:id/token",
      method: "post",
      request: jsonRequest(pluginTokenRequestSchema),
      response: jsonResponse<Infer<typeof pluginTokenResponseSchema>>(),
    }),
    installJobs: defineRoute({
      path: "/plugins/install-jobs",
      method: "get",
      request: noRequest(),
      response:
        jsonResponse<Infer<typeof pluginInstallJobListResponseSchema>>(),
    }),
    installJob: defineRoute({
      path: "/plugins/install-jobs/:jobId",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginInstallJobResponseSchema>>(),
    }),
    cancelInstallJob: defineRoute({
      path: "/plugins/install-jobs/:jobId/cancel",
      method: "post",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginInstallJobResponseSchema>>(),
    }),
    updateJobs: defineRoute({
      path: "/plugins/update-jobs",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginUpdateJobListResponseSchema>>(),
    }),
    updateJob: defineRoute({
      path: "/plugins/update-jobs/:jobId",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginUpdateJobResponseSchema>>(),
    }),
  },
  pluginCatalog: {
    status: defineRoute({
      path: "/plugin-catalog",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Infer<typeof pluginCatalogStatusResponseSchema>>(),
    }),
    search: defineRoute({
      path: "/plugin-catalog/search",
      method: "get",
      request: optionalQueryRequest(pluginCatalogSearchQuerySchema),
      response: jsonResponse<Infer<typeof pluginCatalogSearchResponseSchema>>(),
    }),
    installPlan: defineRoute({
      path: "/plugin-catalog/install-plan",
      method: "get",
      request: optionalQueryRequest(pluginCatalogInstallPlanQuerySchema),
      response:
        jsonResponse<Infer<typeof pluginCatalogInstallPlanResponseSchema>>(),
    }),
    install: defineRoute({
      path: "/plugin-catalog/install",
      method: "post",
      request: jsonRequest(pluginCatalogInstallRequestSchema),
      response: [
        jsonResponse<PluginEnableResponse>(),
        jsonResponse<Infer<typeof pluginInstallJobStartResponseSchema>, 202>({
          status: 202,
        }),
      ],
    }),
  },
  marketplaces: {
    list: defineRoute({
      path: "/marketplaces",
      method: "get",
      request: noRequest(),
      response:
        jsonResponse<Infer<typeof pluginMarketplaceListResponseSchema>>(),
    }),
    add: defineRoute({
      path: "/marketplaces",
      method: "post",
      request: jsonRequest(pluginMarketplaceAddRequestSchema),
      response:
        jsonResponse<Infer<typeof pluginMarketplaceMutationResponseSchema>>(),
    }),
    refresh: defineRoute({
      path: "/marketplaces/refresh",
      method: "post",
      request: jsonRequest(pluginMarketplaceRefreshRequestSchema),
      response:
        jsonResponse<Infer<typeof pluginMarketplaceRefreshResponseSchema>>(),
    }),
    remove: defineRoute({
      path: "/marketplaces/:name",
      method: "delete",
      request: noRequest(),
      response:
        jsonResponse<Infer<typeof pluginMarketplaceRemoveResponseSchema>>(),
    }),
  },
  skillsRegistry: {
    list: defineRoute({
      path: "/skills-registry",
      method: "get",
      request: optionalQueryRequest(registrySkillListQuerySchema),
      response: jsonResponse<Infer<typeof registrySkillsPageSchema>>(),
    }),
    entry: defineRoute({
      path: "/skills-registry/entry",
      method: "get",
      request: optionalQueryRequest(registrySkillEntryQuerySchema),
      response: jsonResponse<Infer<typeof registrySkillSchema>>(),
    }),
    entries: defineRoute({
      path: "/skills-registry/entries",
      method: "post",
      request: jsonRequest(registrySkillEntriesRequestSchema),
      response:
        jsonResponse<Infer<typeof registrySkillEntriesResponseSchema>>(),
    }),
    repositoryStars: defineRoute({
      path: "/skills-registry/repository-stars",
      method: "get",
      request: optionalQueryRequest(registryRepositoryStarsQuerySchema),
      response: jsonResponse<RegistryRepositoryStarsResponse>(),
    }),
    detail: defineRoute({
      path: "/skills-registry/detail",
      method: "get",
      request: optionalQueryRequest(registrySkillDetailQuerySchema),
      response: jsonResponse<Infer<typeof registrySkillDetailSchema>>(),
    }),
    install: defineRoute({
      path: "/skills-registry/install",
      method: "post",
      request: jsonRequest(registrySkillInstallRequestSchema),
      response:
        jsonResponse<Infer<typeof registrySkillInstallResponseSchema>>(),
    }),
    installJobStart: defineRoute({
      path: "/skills-registry/install-jobs",
      method: "post",
      request: jsonRequest(registrySkillInstallRequestSchema),
      response: jsonResponse<
        Infer<typeof registrySkillInstallJobResponseSchema>,
        202
      >({ status: 202 }),
    }),
    installJobGet: defineRoute({
      path: "/skills-registry/install-jobs/:jobId",
      method: "get",
      request: noRequest(),
      response:
        jsonResponse<Infer<typeof registrySkillInstallJobResponseSchema>>(),
    }),
  },
};
