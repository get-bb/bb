import {
  pluginUpdateJobResponseSchema,
  pluginUpdateJobListResponseSchema,
  type PluginUpdateJob,
} from "@bb/server-contract";
export type { PluginUpdateJob } from "@bb/server-contract";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  installedPluginSchema,
  pluginRpcDiscoveryQuerySchema,
  pluginRpcDiscoveryResponseSchema,
  type PluginRpcDiscoveryQuery,
  type PublishedPluginRpcMethod,
  pluginCatalogInstallPlanResponseSchema,
  pluginCatalogInstallRequestSchema,
  pluginCatalogSearchResponseSchema,
  pluginCatalogStatusResponseSchema,
  pluginMarketplaceAddRequestSchema,
  pluginMarketplaceListResponseSchema,
  pluginMarketplaceMutationResponseSchema,
  pluginMarketplaceNameSchema,
  pluginMarketplaceRefreshRequestSchema,
  pluginMarketplaceRefreshResponseSchema,
  pluginMarketplaceRemoveResponseSchema,
  pluginApplyUpdateRequestSchema,
  pluginApplyUpdateResultSchema,
  pluginInstallJobListResponseSchema,
  pluginInstallJobResponseSchema,
  pluginInstallJobStartResponseSchema,
  pluginCachePruneRequestSchema,
  pluginCachePruneResponseSchema,
  pluginInstallRequestSchema,
  pluginRemoveResponseSchema,
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
  type InstalledPlugin,
  type PluginCatalogInstallPlan as PluginCatalogInstallPlanContract,
  type PluginCatalogResolvedSource,
  type PluginCatalogSearchResponse as PluginCatalogSearchResponseContract,
  type PluginCatalogSearchResult as PluginCatalogSearchContract,
  type PluginMarketplace as PluginMarketplaceContract,
  type PluginMarketplaceRefreshResult as PluginMarketplaceRefreshContract,
  type PluginCatalogStatus as PluginCatalogStatusContract,
  type PluginInstallJob as PluginInstallJobContract,
  type PluginApplyUpdateResult as PluginApplyUpdateContract,
  type PluginCachePruneResponse,
  type PluginListResponse,
  type PluginReloadResponse,
  type PluginRemoveResponse,
  type PluginSafeModeResponse,
  type PluginSafeModeUpdateResponse,
  type PluginSettingsResponse,
  type PluginSourceDetail,
  type PluginSourceSelection,
  type PluginTokenResponse,
  type PluginUpdateCheckEntry,
} from "@bb/server-contract";
import { z } from "zod";
import { waitForJob } from "../job-wait.js";
import type { CreateSdkAreaArgs } from "./common.js";

/**
 * A server older than `providerIds` (bb-app < 0.39) or `icons` answers with
 * the installed-plugin shape minus those fields. The contract keeps them
 * required — the server fills them once at its boundary — so the tolerance
 * lives here, on the response side only: the SDK never sends this shape, and a
 * default on the contract would leak into request bodies.
 */
const installedPluginResponseSchema = installedPluginSchema.extend({
  screenshots: installedPluginSchema.shape.screenshots.default([]),
  collections: installedPluginSchema.shape.collections.default([]),
  providerIds: z.array(z.string()).default([]),
  icons: z.record(z.string(), z.string()).default({}),
});
const pluginListResponseSchema = z.object({
  plugins: z.array(installedPluginResponseSchema),
});
const pluginInstallResponseSchema = z.object({
  ok: z.literal(true),
  plugin: installedPluginResponseSchema,
});
const pluginInstallStartResponseSchema = z.union([
  pluginInstallJobStartResponseSchema,
  pluginInstallResponseSchema,
]);
const INSTALL_JOB_POLL_INTERVAL_MS = 500;
const pluginReloadResponseSchema = z.object({
  ok: z.literal(true),
  plugins: z.array(installedPluginResponseSchema),
});
const pluginCatalogSearchResponseCompatibilitySchema =
  pluginCatalogSearchResponseSchema.extend({
    collections: pluginCatalogSearchResponseSchema.shape.collections.default(
      [],
    ),
  });

export const pluginMutationResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  plugin: installedPluginResponseSchema.optional(),
  plugins: z.array(installedPluginResponseSchema).optional(),
});
export type PluginMutationResponse = z.infer<
  typeof pluginMutationResponseSchema
>;

export interface PluginIdArgs {
  pluginId: string;
}

export interface PluginApplyUpdateArgs extends PluginIdArgs {
  range?: string;
  expectedVersion?: string;
}

export interface PluginInstallArgs {
  source: string;
  subdirectory?: string;
  plugin?: string;
}

export interface PluginCatalogInstallArgs {
  entryId: string;
  marketplace?: string;
  confirmedSource?: PluginCatalogResolvedSource;
}

export interface PluginInstallJobArgs {
  jobId: string;
}

export interface PluginInstallJobListArgs {
  signal?: AbortSignal;
}

export interface PluginCatalogInstallPlanArgs {
  entryId: string;
  marketplace?: string;
  signal?: AbortSignal;
}

export interface PluginMarketplaceAddArgs {
  source: string;
  subdirectory?: string;
}

export interface PluginMarketplaceListArgs {
  signal?: AbortSignal;
}

export interface PluginMarketplaceRefreshArgs {
  name?: string;
  signal?: AbortSignal;
}

export interface PluginMarketplaceRemoveArgs {
  name: string;
}

export interface PluginReloadArgs {
  pluginId?: string;
}

export interface PluginSettingsUpdateArgs extends PluginIdArgs {
  values: Record<string, JsonValue>;
}

export interface PluginTokenArgs extends PluginIdArgs {
  rotate?: boolean;
}

export interface PluginCheckUpdatesArgs {
  pluginId?: string;
  signal?: AbortSignal;
}

export interface PluginRpcArgs<TOutput> extends PluginIdArgs {
  signal?: AbortSignal;
  input?: JsonValue;
  method: string;
  outputSchema: z.ZodType<TOutput>;
}

export interface PluginCatalogSearchArgs {
  query: string;
  signal?: AbortSignal;
}

export interface PluginCatalogStatusArgs {
  signal?: AbortSignal;
}

export interface PluginGetSettingsArgs extends PluginIdArgs {
  signal?: AbortSignal;
}

export interface PluginGetSourceArgs extends PluginIdArgs {
  signal?: AbortSignal;
}

export interface PluginListArgs {
  signal?: AbortSignal;
}

export interface PluginListUpdateResultsArgs {
  signal?: AbortSignal;
}

export interface PluginGetSafeModeArgs {
  signal?: AbortSignal;
}

export interface PluginRpcDiscoveryArgs extends PluginRpcDiscoveryQuery {
  signal?: AbortSignal;
}

export interface PluginSetSafeModeArgs {
  enabled: boolean;
}

export interface PluginPruneCacheArgs {
  dryRun?: boolean;
  signal?: AbortSignal;
}

export type PluginDisableResult = InstalledPlugin;
export type PluginEnableResult = InstalledPlugin;
export type PluginGetSettingsResult = PluginSettingsResponse;
export type PluginInstallResult = InstalledPlugin;
export type PluginInstallJob = PluginInstallJobContract;
export type PluginListResult = PluginListResponse;
export type PluginReloadResult = PluginReloadResponse;
export type PluginRemoveResult = PluginRemoveResponse;
export type PluginSafeModeResult = PluginSafeModeResponse;
export type PluginSetSafeModeResult = PluginSafeModeUpdateResponse;
export type PluginPruneCacheResult = PluginCachePruneResponse;
export type PluginTokenResult = PluginTokenResponse;
export type PluginUpdateSettingsResult = PluginSettingsResponse;
export type PluginGetSourceResult = PluginSourceDetail;
export type PluginCheckUpdatesResult = PluginUpdateCheckEntry[];
export type PluginApplyUpdateResult = PluginApplyUpdateContract;

export type PluginCatalogStatusResult = PluginCatalogStatusContract;
export type PluginCatalogSearchEntry = PluginCatalogSearchContract;
export type PluginCatalogSearchResult = PluginCatalogSearchResponseContract;
export type PluginCatalogInstallPlanResult = PluginCatalogInstallPlanContract;
export type PluginMarketplaceListResult = PluginMarketplaceContract[];
export type PluginMarketplaceAddResult = PluginMarketplaceContract;
export type PluginMarketplaceRefreshResult = PluginMarketplaceRefreshContract[];

export interface PluginMarketplaceRemoveResult {
  convertedPluginIds: string[];
}

export interface PluginCatalogArea {
  install(args: PluginCatalogInstallArgs): Promise<PluginInstallResult>;
  startInstall(args: PluginCatalogInstallArgs): Promise<PluginInstallJob>;
  installPlan(
    args: PluginCatalogInstallPlanArgs,
  ): Promise<PluginCatalogInstallPlanResult>;
  search(args: PluginCatalogSearchArgs): Promise<PluginCatalogSearchResult>;
  status(args?: PluginCatalogStatusArgs): Promise<PluginCatalogStatusResult>;
}

export interface PluginMarketplacesArea {
  add(args: PluginMarketplaceAddArgs): Promise<PluginMarketplaceAddResult>;
  list(args?: PluginMarketplaceListArgs): Promise<PluginMarketplaceListResult>;
  refresh(
    args?: PluginMarketplaceRefreshArgs,
  ): Promise<PluginMarketplaceRefreshResult>;
  remove(
    args: PluginMarketplaceRemoveArgs,
  ): Promise<PluginMarketplaceRemoveResult>;
}

export interface PluginInstallJobsArea {
  cancel(args: PluginInstallJobArgs): Promise<PluginInstallJob>;
  get(args: PluginInstallJobArgs): Promise<PluginInstallJob>;
  list(args?: PluginInstallJobListArgs): Promise<PluginInstallJob[]>;
}

export interface PluginUpdateJobsArea {
  get(args: { jobId: string }): Promise<PluginUpdateJob>;
  list(args?: { signal?: AbortSignal }): Promise<PluginUpdateJob[]>;
}

export interface PluginsArea {
  experimental_discoverRpc(
    args?: PluginRpcDiscoveryArgs,
  ): Promise<PublishedPluginRpcMethod[]>;
  experimental_getSafeMode(
    args?: PluginGetSafeModeArgs,
  ): Promise<PluginSafeModeResult>;
  experimental_setSafeMode(
    args: PluginSetSafeModeArgs,
  ): Promise<PluginSetSafeModeResult>;
  experimental_pruneCache(
    args?: PluginPruneCacheArgs,
  ): Promise<PluginPruneCacheResult>;
  applyUpdate(args: PluginApplyUpdateArgs): Promise<PluginApplyUpdateResult>;
  experimental_startUpdate(
    args: PluginApplyUpdateArgs,
  ): Promise<PluginUpdateJob>;
  experimental_updateJobs: PluginUpdateJobsArea;
  callRpc<TOutput>(args: PluginRpcArgs<TOutput>): Promise<TOutput>;
  checkUpdates(
    args?: PluginCheckUpdatesArgs,
  ): Promise<PluginCheckUpdatesResult>;
  catalog: PluginCatalogArea;
  marketplaces: PluginMarketplacesArea;
  disable(args: PluginIdArgs): Promise<PluginDisableResult>;
  enable(args: PluginIdArgs): Promise<PluginEnableResult>;
  getSettings(args: PluginGetSettingsArgs): Promise<PluginGetSettingsResult>;
  getSource(args: PluginGetSourceArgs): Promise<PluginGetSourceResult>;
  install(args: PluginInstallArgs): Promise<PluginInstallResult>;
  startInstall(args: PluginInstallArgs): Promise<PluginInstallJob>;
  installJobs: PluginInstallJobsArea;
  list(args?: PluginListArgs): Promise<PluginListResult>;
  listUpdateResults(
    args?: PluginListUpdateResultsArgs,
  ): Promise<PluginCheckUpdatesResult>;
  reload(args?: PluginReloadArgs): Promise<PluginReloadResult>;
  remove(args: PluginIdArgs): Promise<PluginRemoveResult>;
  token(args: PluginTokenArgs): Promise<PluginTokenResult>;
  updateSettings(
    args: PluginSettingsUpdateArgs,
  ): Promise<PluginUpdateSettingsResult>;
}

function pluginSourceSelection(
  args: PluginInstallArgs,
): PluginSourceSelection | undefined {
  if (args.subdirectory !== undefined) {
    return { kind: "subdirectory", path: args.subdirectory };
  }
  if (args.plugin !== undefined) return { kind: "entry", name: args.plugin };
  return undefined;
}

function nonEmptyId(value: string): string {
  return z.string().min(1).parse(value);
}

function pluginPath(pluginId: string, suffix = ""): string {
  return `/api/v1/plugins/${encodeURIComponent(nonEmptyId(pluginId))}${suffix}`;
}

const RESPOND_ASYNC = { headers: { prefer: "respond-async" } };

export function createPluginsArea(args: CreateSdkAreaArgs): PluginsArea {
  const { transport } = args;
  const { call } = args.operations;

  async function requestParsed<TOutput>(
    path: string,
    schema: z.ZodType<TOutput>,
    init?: RequestInit,
  ): Promise<TOutput> {
    const url = transport.baseUrl
      ? `${transport.baseUrl.replace(/\/$/u, "")}${path}`
      : path;
    const response = await transport.resolve(transport.fetch(url, init));
    const json: unknown = await response.json();
    return schema.parse(json);
  }

  const updateJobs: PluginUpdateJobsArea = {
    async get(input) {
      const response = pluginUpdateJobResponseSchema.parse(
        await call("plugins.updateJob", { jobId: nonEmptyId(input.jobId) }),
      );
      return response.job;
    },
    async list(input = {}) {
      const response = pluginUpdateJobListResponseSchema.parse(
        await call("plugins.updateJobs", {}, { signal: input.signal }),
      );
      return response.jobs;
    },
  };

  async function requestUpdate({ pluginId, ...body }: PluginApplyUpdateArgs) {
    return z
      .union([pluginUpdateJobResponseSchema, pluginApplyUpdateResultSchema])
      .parse(
        await call(
          "plugins.applyUpdate",
          {
            id: nonEmptyId(pluginId),
            ...pluginApplyUpdateRequestSchema.parse(body),
          },
          RESPOND_ASYNC,
        ),
      );
  }

  const installJobs: PluginInstallJobsArea = {
    async cancel(input) {
      const response = pluginInstallJobResponseSchema.parse(
        await call("plugins.cancelInstallJob", {
          jobId: nonEmptyId(input.jobId),
        }),
      );
      return response.job;
    },
    async get(input) {
      const response = pluginInstallJobResponseSchema.parse(
        await call("plugins.installJob", { jobId: nonEmptyId(input.jobId) }),
      );
      return response.job;
    },
    async list(input = {}) {
      const response = pluginInstallJobListResponseSchema.parse(
        await call("plugins.installJobs", {}, { signal: input.signal }),
      );
      return response.jobs;
    },
  };
  type InstallStart = z.infer<typeof pluginInstallStartResponseSchema>;

  async function installFromSource(
    input: PluginInstallArgs,
  ): Promise<InstallStart> {
    return pluginInstallStartResponseSchema.parse(
      await call("plugins.install", sourceInstallBody(input), RESPOND_ASYNC),
    );
  }

  async function installFromCatalog(
    input: PluginCatalogInstallArgs,
  ): Promise<InstallStart> {
    return pluginInstallStartResponseSchema.parse(
      await call(
        "pluginCatalog.install",
        pluginCatalogInstallRequestSchema.parse(input),
        RESPOND_ASYNC,
      ),
    );
  }

  async function startInstall(
    started: Promise<InstallStart>,
  ): Promise<PluginInstallJob> {
    const response = await started;
    if ("job" in response) return response.job;
    throw new Error(
      `installed "${response.plugin.id}" without an install job; this BB server predates background installs`,
    );
  }

  async function installAndWait(
    started: Promise<InstallStart>,
  ): Promise<InstalledPlugin> {
    const response = await started;
    if ("plugin" in response) return response.plugin;
    const { id } = response.job;
    const job = await waitForJob({
      job: response.job,
      isActive: (current) =>
        current.state === "queued" ||
        current.state === "running" ||
        current.state === "cancelling",
      read: () => installJobs.get({ jobId: id }),
      intervalMs: INSTALL_JOB_POLL_INTERVAL_MS,
    });
    if (job.state === "succeeded") return job.plugin;
    throw new Error(job.state === "failed" ? job.error : "install cancelled");
  }

  function sourceInstallBody(input: PluginInstallArgs) {
    if (input.subdirectory !== undefined && input.plugin !== undefined) {
      throw new Error(
        "plugin install accepts subdirectory or plugin, not both",
      );
    }
    const selection = pluginSourceSelection(input);
    const body =
      selection === undefined
        ? { source: input.source }
        : { source: input.source, selection };
    pluginInstallRequestSchema.parse(body);
    return body;
  }

  const catalog: PluginCatalogArea = {
    install: (input) => installAndWait(installFromCatalog(input)),
    startInstall: (input) => startInstall(installFromCatalog(input)),
    async installPlan(input) {
      const body = pluginCatalogInstallRequestSchema.parse(
        input.marketplace === undefined
          ? { entryId: input.entryId }
          : { entryId: input.entryId, marketplace: input.marketplace },
      );
      const response = pluginCatalogInstallPlanResponseSchema.parse(
        await call(
          "pluginCatalog.installPlan",
          body.marketplace === undefined
            ? { entryId: body.entryId }
            : { entryId: body.entryId, marketplace: body.marketplace },
          { signal: input.signal },
        ),
      );
      return response.plan;
    },
    async search(input) {
      return pluginCatalogSearchResponseCompatibilitySchema.parse(
        await call(
          "pluginCatalog.search",
          { q: z.string().parse(input.query) },
          { signal: input.signal },
        ),
      );
    },
    async status(input = {}) {
      const response = pluginCatalogStatusResponseSchema.parse(
        await call("pluginCatalog.status", {}, { signal: input.signal }),
      );
      return response.catalog;
    },
  };

  const marketplaces: PluginMarketplacesArea = {
    async add(input) {
      const body = pluginMarketplaceAddRequestSchema.parse(input);
      const response = pluginMarketplaceMutationResponseSchema.parse(
        await call("marketplaces.add", body),
      );
      return response.marketplace;
    },
    async list(input = {}) {
      const response = pluginMarketplaceListResponseSchema.parse(
        await call("marketplaces.list", {}, { signal: input.signal }),
      );
      return response.marketplaces;
    },
    async refresh(input = {}) {
      const body = pluginMarketplaceRefreshRequestSchema.parse(
        input.name === undefined ? {} : { name: input.name },
      );
      const response = pluginMarketplaceRefreshResponseSchema.parse(
        await call("marketplaces.refresh", body, { signal: input.signal }),
      );
      return response.results;
    },
    async remove(input) {
      const name = pluginMarketplaceNameSchema.parse(input.name);
      const response = pluginMarketplaceRemoveResponseSchema.parse(
        await call("marketplaces.remove", { name }),
      );
      return { convertedPluginIds: response.convertedPluginIds };
    },
  };

  return {
    async applyUpdate(input) {
      const response = await requestUpdate(input);
      if (!("job" in response)) return response;
      const { id } = response.job;
      const job = await waitForJob({
        job: response.job,
        isActive: (current) =>
          current.state === "queued" || current.state === "running",
        read: () => updateJobs.get({ jobId: id }),
        intervalMs: INSTALL_JOB_POLL_INTERVAL_MS,
      });
      if (job.state === "completed") return job.result;
      throw new Error(
        job.state === "failed" ? job.error : "update did not complete",
      );
    },
    async experimental_startUpdate(input) {
      const response = await requestUpdate(input);
      if ("job" in response) return response.job;
      throw new Error(
        "Update completed without a job; this BB server predates background updates",
      );
    },
    experimental_updateJobs: updateJobs,
    async experimental_discoverRpc(input = {}) {
      const query = pluginRpcDiscoveryQuerySchema.parse(input);
      return pluginRpcDiscoveryResponseSchema.parse(
        await call(
          "plugins.discoverRpc",
          { pluginId: query.pluginId, method: query.method },
          { signal: input.signal },
        ),
      );
    },
    async callRpc(input) {
      const envelope = await requestParsed(
        pluginPath(input.pluginId, `/rpc/${encodeURIComponent(input.method)}`),
        z.object({ ok: z.literal(true), result: jsonValueSchema }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.input ?? null),
          signal: input.signal,
        },
      );
      return input.outputSchema.parse(envelope.result);
    },
    async checkUpdates(input = {}) {
      const body = pluginUpdateCheckRequestSchema.parse(
        input.pluginId === undefined ? {} : { id: input.pluginId },
      );
      const response = pluginUpdateCheckResponseSchema.parse(
        await call("plugins.checkUpdates", body, { signal: input.signal }),
      );
      return response.results;
    },
    async experimental_getSafeMode(input = {}) {
      return pluginSafeModeResponseSchema.parse(
        await call("plugins.safeMode", {}, { signal: input.signal }),
      );
    },
    async experimental_setSafeMode(input) {
      const body = pluginSafeModeRequestSchema.parse({
        enabled: input.enabled,
      });
      return pluginSafeModeUpdateResponseSchema.parse(
        await call("plugins.setSafeMode", body),
      );
    },
    async experimental_pruneCache(input = {}) {
      const body = pluginCachePruneRequestSchema.parse({
        dryRun: input.dryRun ?? false,
      });
      return pluginCachePruneResponseSchema.parse(
        await call("plugins.pruneCache", body, { signal: input.signal }),
      );
    },
    catalog,
    marketplaces,
    async disable(input) {
      const response = pluginInstallResponseSchema.parse(
        await call("plugins.disable", { id: nonEmptyId(input.pluginId) }),
      );
      return response.plugin;
    },
    async enable(input) {
      const response = pluginInstallResponseSchema.parse(
        await call("plugins.enable", { id: nonEmptyId(input.pluginId) }),
      );
      return response.plugin;
    },
    async getSettings(input) {
      return pluginSettingsResponseSchema.parse(
        await call(
          "plugins.settings",
          { id: nonEmptyId(input.pluginId) },
          { signal: input.signal },
        ),
      );
    },
    async getSource(input) {
      return pluginSourceDetailSchema.parse(
        await call(
          "plugins.source",
          { id: nonEmptyId(input.pluginId) },
          { signal: input.signal },
        ),
      );
    },
    install: (input) => installAndWait(installFromSource(input)),
    startInstall: (input) => startInstall(installFromSource(input)),
    installJobs,
    async list(input = {}) {
      return pluginListResponseSchema.parse(
        await call("plugins.list", {}, { signal: input.signal }),
      );
    },
    async listUpdateResults(input = {}) {
      const response = pluginUpdateCheckResponseSchema.parse(
        await call("plugins.updates", {}, { signal: input.signal }),
      );
      return response.results;
    },
    async reload(input = {}) {
      return pluginReloadResponseSchema.parse(
        await call(
          "plugins.reload",
          input.pluginId ? { id: nonEmptyId(input.pluginId) } : {},
        ),
      );
    },
    async remove(input) {
      return pluginRemoveResponseSchema.parse(
        await call("plugins.remove", { id: nonEmptyId(input.pluginId) }),
      );
    },
    async token(input) {
      const body = pluginTokenRequestSchema.parse({
        rotate: input.rotate ?? false,
      });
      return pluginTokenResponseSchema.parse(
        await call("plugins.token", {
          id: nonEmptyId(input.pluginId),
          ...body,
        }),
      );
    },
    async updateSettings(input) {
      const body = pluginSettingsUpdateRequestSchema.parse({
        values: input.values,
      });
      return pluginSettingsResponseSchema.parse(
        await call("plugins.updateSettings", {
          id: nonEmptyId(input.pluginId),
          ...body,
        }),
      );
    },
  };
}
