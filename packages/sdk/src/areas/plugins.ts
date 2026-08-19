import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
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
  pluginInstallResponseSchema,
  pluginInstallSourceRequestSchema,
  pluginListResponseSchema,
  pluginReloadResponseSchema,
  pluginRemoveResponseSchema,
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
  type PluginCatalogSearchResult as PluginCatalogSearchContract,
  type PluginMarketplace as PluginMarketplaceContract,
  type PluginMarketplaceRefreshResult as PluginMarketplaceRefreshContract,
  type PluginCatalogStatus as PluginCatalogStatusContract,
  type PluginApplyUpdateResult as PluginApplyUpdateContract,
  type PluginListResponse,
  type PluginReloadResponse,
  type PluginRemoveResponse,
  type PluginSettingsResponse,
  type PluginSourceDetail,
  type PluginSourceSelection,
  type PluginTokenResponse,
  type PluginUpdateCheckEntry,
} from "@bb/server-contract";
import { z } from "zod";
import type { CreateSdkAreaArgs } from "./common.js";

export interface PluginIdArgs {
  pluginId: string;
}

/** Install directly from a path:, git:, npm:, or builtin: source spec. */
export interface PluginInstallArgs {
  /**
   * `path:<dir>`, `builtin:<name>`, `npm:<package>[@<version|tag|range>]`, or
   * `git:<url>[@<spec>]`. A git spec is one ref, or a semver range resolved
   * over the repository's `[<tagPrefix>]vX.Y.Z` release tags:
   * `git:<url>@semver:<range>` and `git:<url>@semver:<tagPrefix>:<range>` say
   * range explicitly, `git:<url>@ref:<name>` says ref explicitly, and a bare
   * `^1.2.0` resolves over tags unless the repository also has a ref of that
   * literal name (which is refused as ambiguous).
   */
  source: string;
  /**
   * Directory of a multi-plugin repository to install, relative to the
   * repository root (`git:` and `path:` sources only).
   */
  subdirectory?: string;
  /**
   * Name of a `.bb/plugins.json` collection entry to install, resolved to its
   * directory in the repository. Mutually exclusive with `subdirectory`.
   */
  plugin?: string;
}

/** Install a catalog entry, from BB's official catalog or another marketplace. */
export interface PluginCatalogInstallArgs {
  entryId: string;
  /**
   * Marketplace that lists the entry. Omitted resolves across every
   * marketplace: exactly one match installs, none falls back to the bundled
   * official plugin of that name, and several are refused as ambiguous.
   */
  marketplace?: string;
  /**
   * Source facts returned by installPlan for a third-party entry. The server
   * refuses the install when the listing or its git commit changed afterward.
   */
  confirmedSource?: PluginCatalogResolvedSource;
}

/** Ask what an install would do before confirming it. */
export interface PluginCatalogInstallPlanArgs {
  entryId: string;
  marketplace?: string;
  signal?: AbortSignal;
}

/** Add a marketplace by `https:` manifest URL, `git:<url>[@ref]`, or `path:<dir>`. */
export interface PluginMarketplaceAddArgs {
  source: string;
}

export interface PluginMarketplaceListArgs {
  signal?: AbortSignal;
}

export interface PluginMarketplaceRefreshArgs {
  /** One marketplace to refresh; omitted refreshes every one of them. */
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

export type PluginDisableResult = InstalledPlugin;
export type PluginEnableResult = InstalledPlugin;
export type PluginGetSettingsResult = PluginSettingsResponse;
export type PluginInstallResult = InstalledPlugin;
export type PluginListResult = PluginListResponse;
export type PluginReloadResult = PluginReloadResponse;
export type PluginRemoveResult = PluginRemoveResponse;
export type PluginTokenResult = PluginTokenResponse;
export type PluginUpdateSettingsResult = PluginSettingsResponse;
export type PluginGetSourceResult = PluginSourceDetail;
export type PluginCheckUpdatesResult = PluginUpdateCheckEntry[];
export type PluginApplyUpdateResult = PluginApplyUpdateContract;

export type PluginCatalogStatusResult = PluginCatalogStatusContract;
export type PluginCatalogSearchResult = PluginCatalogSearchContract[];
export type PluginCatalogInstallPlanResult = PluginCatalogInstallPlanContract;
export type PluginMarketplaceListResult = PluginMarketplaceContract[];
export type PluginMarketplaceAddResult = PluginMarketplaceContract;
export type PluginMarketplaceRefreshResult = PluginMarketplaceRefreshContract[];

export interface PluginMarketplaceRemoveResult {
  /** Installs whose provenance became `direct`; they keep running as before. */
  convertedPluginIds: string[];
}

export interface PluginCatalogArea {
  install(args: PluginCatalogInstallArgs): Promise<PluginInstallResult>;
  /** The true resolved source an install would use, before anything runs. */
  installPlan(
    args: PluginCatalogInstallPlanArgs,
  ): Promise<PluginCatalogInstallPlanResult>;
  search(args: PluginCatalogSearchArgs): Promise<PluginCatalogSearchResult>;
  status(args?: PluginCatalogStatusArgs): Promise<PluginCatalogStatusResult>;
}

/** Registered marketplaces. Adding one installs nothing; removing one uninstalls nothing. */
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

export interface PluginsArea {
  applyUpdate(args: PluginIdArgs): Promise<PluginApplyUpdateResult>;
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

/**
 * Returns the explicit selection a caller asked for, or `undefined` for a
 * plain root install. The server fills the root default itself, and older
 * servers validate the install body with a strict `{ source }`-only schema,
 * so the SDK must not send a `selection` key the caller did not ask for.
 */
function pluginSourceSelection(
  args: PluginInstallArgs,
): PluginSourceSelection | undefined {
  if (args.subdirectory !== undefined) {
    return { kind: "subdirectory", path: args.subdirectory };
  }
  if (args.plugin !== undefined) return { kind: "entry", name: args.plugin };
  return undefined;
}

function pluginPath(pluginId: string, suffix = ""): string {
  const id = z.string().min(1).parse(pluginId);
  return `/api/v1/plugins/${encodeURIComponent(id)}${suffix}`;
}

export function createPluginsArea(args: CreateSdkAreaArgs): PluginsArea {
  const { transport } = args;

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

  function jsonInit(method: "POST" | "PUT", body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  const catalog: PluginCatalogArea = {
    async install(input) {
      const body = pluginCatalogInstallRequestSchema.parse(input);
      const response = await requestParsed(
        "/api/v1/plugin-catalog/install",
        pluginInstallResponseSchema,
        jsonInit("POST", body),
      );
      return response.plugin;
    },
    async installPlan(input) {
      const body = pluginCatalogInstallRequestSchema.parse(
        input.marketplace === undefined
          ? { entryId: input.entryId }
          : { entryId: input.entryId, marketplace: input.marketplace },
      );
      const query = new URLSearchParams({ entryId: body.entryId });
      if (body.marketplace !== undefined) {
        query.set("marketplace", body.marketplace);
      }
      const response = await requestParsed(
        `/api/v1/plugin-catalog/install-plan?${query.toString()}`,
        pluginCatalogInstallPlanResponseSchema,
        { signal: input.signal },
      );
      return response.plan;
    },
    async search(input) {
      const query = z.string().parse(input.query);
      const response = await requestParsed(
        `/api/v1/plugin-catalog/search?q=${encodeURIComponent(query)}`,
        pluginCatalogSearchResponseSchema,
        { signal: input.signal },
      );
      return response.results;
    },
    async status(input = {}) {
      const response = await requestParsed(
        "/api/v1/plugin-catalog",
        pluginCatalogStatusResponseSchema,
        { signal: input.signal },
      );
      return response.catalog;
    },
  };

  const marketplaces: PluginMarketplacesArea = {
    async add(input) {
      const body = pluginMarketplaceAddRequestSchema.parse(input);
      const response = await requestParsed(
        "/api/v1/marketplaces",
        pluginMarketplaceMutationResponseSchema,
        jsonInit("POST", body),
      );
      return response.marketplace;
    },
    async list(input = {}) {
      const response = await requestParsed(
        "/api/v1/marketplaces",
        pluginMarketplaceListResponseSchema,
        { signal: input.signal },
      );
      return response.marketplaces;
    },
    async refresh(input = {}) {
      const body = pluginMarketplaceRefreshRequestSchema.parse(
        input.name === undefined ? {} : { name: input.name },
      );
      const response = await requestParsed(
        "/api/v1/marketplaces/refresh",
        pluginMarketplaceRefreshResponseSchema,
        { ...jsonInit("POST", body), signal: input.signal },
      );
      return response.results;
    },
    async remove(input) {
      const name = pluginMarketplaceNameSchema.parse(input.name);
      const response = await requestParsed(
        `/api/v1/marketplaces/${encodeURIComponent(name)}`,
        pluginMarketplaceRemoveResponseSchema,
        { method: "DELETE" },
      );
      return { convertedPluginIds: response.convertedPluginIds };
    },
  };

  return {
    async applyUpdate(input) {
      const body = pluginApplyUpdateRequestSchema.parse({});
      return requestParsed(
        pluginPath(input.pluginId, "/update"),
        pluginApplyUpdateResultSchema,
        jsonInit("POST", body),
      );
    },
    async callRpc(input) {
      const envelope = await requestParsed(
        pluginPath(input.pluginId, `/rpc/${encodeURIComponent(input.method)}`),
        z.object({ ok: z.literal(true), result: jsonValueSchema }),
        jsonInit("POST", input.input ?? null),
      );
      return input.outputSchema.parse(envelope.result);
    },
    async checkUpdates(input = {}) {
      const body = pluginUpdateCheckRequestSchema.parse(
        input.pluginId === undefined ? {} : { id: input.pluginId },
      );
      const response = await requestParsed(
        "/api/v1/plugins/updates/check",
        pluginUpdateCheckResponseSchema,
        { ...jsonInit("POST", body), signal: input.signal },
      );
      return response.results;
    },
    catalog,
    marketplaces,
    async disable(input) {
      const response = await requestParsed(
        pluginPath(input.pluginId, "/disable"),
        pluginInstallResponseSchema,
        jsonInit("POST", {}),
      );
      return response.plugin;
    },
    async enable(input) {
      const response = await requestParsed(
        pluginPath(input.pluginId, "/enable"),
        pluginInstallResponseSchema,
        jsonInit("POST", {}),
      );
      return response.plugin;
    },
    async getSettings(input) {
      return requestParsed(
        pluginPath(input.pluginId, "/settings"),
        pluginSettingsResponseSchema,
        { signal: input.signal },
      );
    },
    async getSource(input) {
      return requestParsed(
        pluginPath(input.pluginId, "/source"),
        pluginSourceDetailSchema,
        { signal: input.signal },
      );
    },
    async install(input) {
      if (input.subdirectory !== undefined && input.plugin !== undefined) {
        throw new Error(
          "plugin install accepts subdirectory or plugin, not both",
        );
      }
      const selection = pluginSourceSelection(input);
      // Send only the keys the caller set. `.parse` validates the body but
      // its output would fill in the root default the server owns.
      const body =
        selection === undefined
          ? { source: input.source }
          : { source: input.source, selection };
      pluginInstallSourceRequestSchema.parse(body);
      const response = await requestParsed(
        "/api/v1/plugins/install",
        pluginInstallResponseSchema,
        jsonInit("POST", body),
      );
      return response.plugin;
    },
    async list(input = {}) {
      return requestParsed("/api/v1/plugins", pluginListResponseSchema, {
        signal: input.signal,
      });
    },
    async listUpdateResults(input = {}) {
      const response = await requestParsed(
        "/api/v1/plugins/updates",
        pluginUpdateCheckResponseSchema,
        { signal: input.signal },
      );
      return response.results;
    },
    async reload(input = {}) {
      const query = input.pluginId
        ? `?id=${encodeURIComponent(z.string().min(1).parse(input.pluginId))}`
        : "";
      return requestParsed(
        `/api/v1/plugins/reload${query}`,
        pluginReloadResponseSchema,
        jsonInit("POST", {}),
      );
    },
    async remove(input) {
      return requestParsed(
        pluginPath(input.pluginId),
        pluginRemoveResponseSchema,
        { method: "DELETE" },
      );
    },
    async token(input) {
      const body = pluginTokenRequestSchema.parse({
        rotate: input.rotate ?? false,
      });
      return requestParsed(
        pluginPath(input.pluginId, "/token"),
        pluginTokenResponseSchema,
        jsonInit("POST", body),
      );
    },
    async updateSettings(input) {
      const body = pluginSettingsUpdateRequestSchema.parse({
        values: input.values,
      });
      return requestParsed(
        pluginPath(input.pluginId, "/settings"),
        pluginSettingsResponseSchema,
        jsonInit("PUT", body),
      );
    },
  };
}
