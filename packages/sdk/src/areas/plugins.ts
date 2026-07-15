import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  marketplaceAddRequestSchema,
  marketplaceListResponseSchema,
  marketplaceMutationResponseSchema,
  marketplaceRemoveResponseSchema,
  marketplaceSearchResponseSchema,
  pluginApplyUpdateRequestSchema,
  pluginApplyUpdateResultSchema,
  pluginInstallMarketplaceRequestSchema,
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
  type MarketplaceAddRequest,
  type MarketplaceRemoveResponse,
  type MarketplaceSearchResult,
  type MarketplaceView,
  type PluginApplyUpdateResult as PluginApplyUpdateContract,
  type PluginListResponse,
  type PluginReloadResponse,
  type PluginRemoveResponse,
  type PluginSettingsResponse,
  type PluginSourceDetail,
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
  source: string;
}

/** Install a catalog entry, optionally selecting an exact published version. */
export interface PluginInstallFromMarketplaceArgs {
  marketplaceId: string;
  entryId: string;
  version?: string;
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
}

export interface PluginRpcArgs<TOutput> extends PluginIdArgs {
  input?: JsonValue;
  method: string;
  outputSchema: z.ZodType<TOutput>;
}

export interface PluginMarketplaceRefreshArgs {
  marketplaceId: string;
}

export interface PluginMarketplaceRemoveArgs {
  marketplaceId: string;
}

export interface PluginMarketplaceSearchArgs {
  query: string;
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

export type PluginMarketplaceListResult = MarketplaceView[];
export type PluginMarketplaceAddResult = MarketplaceView;
export type PluginMarketplaceSearchResult = MarketplaceSearchResult[];
export type PluginMarketplaceRefreshResult = MarketplaceView;
export type PluginMarketplaceRemoveResult = MarketplaceRemoveResponse;

export interface PluginMarketplacesArea {
  add(args: MarketplaceAddRequest): Promise<PluginMarketplaceAddResult>;
  list(): Promise<PluginMarketplaceListResult>;
  refresh(
    args: PluginMarketplaceRefreshArgs,
  ): Promise<PluginMarketplaceRefreshResult>;
  remove(
    args: PluginMarketplaceRemoveArgs,
  ): Promise<PluginMarketplaceRemoveResult>;
  search(
    args: PluginMarketplaceSearchArgs,
  ): Promise<PluginMarketplaceSearchResult>;
}

export interface PluginsArea {
  applyUpdate(args: PluginIdArgs): Promise<PluginApplyUpdateResult>;
  callRpc<TOutput>(args: PluginRpcArgs<TOutput>): Promise<TOutput>;
  checkUpdates(
    args?: PluginCheckUpdatesArgs,
  ): Promise<PluginCheckUpdatesResult>;
  disable(args: PluginIdArgs): Promise<PluginDisableResult>;
  enable(args: PluginIdArgs): Promise<PluginEnableResult>;
  getSettings(args: PluginIdArgs): Promise<PluginGetSettingsResult>;
  getSource(args: PluginIdArgs): Promise<PluginGetSourceResult>;
  install(args: PluginInstallArgs): Promise<PluginInstallResult>;
  installFromMarketplace(
    args: PluginInstallFromMarketplaceArgs,
  ): Promise<PluginInstallResult>;
  list(): Promise<PluginListResult>;
  listUpdateResults(): Promise<PluginCheckUpdatesResult>;
  marketplaces: PluginMarketplacesArea;
  reload(args?: PluginReloadArgs): Promise<PluginReloadResult>;
  remove(args: PluginIdArgs): Promise<PluginRemoveResult>;
  token(args: PluginTokenArgs): Promise<PluginTokenResult>;
  updateSettings(
    args: PluginSettingsUpdateArgs,
  ): Promise<PluginUpdateSettingsResult>;
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

  const marketplaces: PluginMarketplacesArea = {
    async add(input) {
      const body = marketplaceAddRequestSchema.parse(input);
      const response = await requestParsed(
        "/api/v1/marketplaces",
        marketplaceMutationResponseSchema,
        jsonInit("POST", body),
      );
      return response.marketplace;
    },
    async list() {
      const response = await requestParsed(
        "/api/v1/marketplaces",
        marketplaceListResponseSchema,
      );
      return response.marketplaces;
    },
    async refresh(input) {
      const marketplaceId = z.string().min(1).parse(input.marketplaceId);
      const response = await requestParsed(
        `/api/v1/marketplaces/${encodeURIComponent(marketplaceId)}/refresh`,
        marketplaceMutationResponseSchema,
        jsonInit("POST", {}),
      );
      return response.marketplace;
    },
    async remove(input) {
      const marketplaceId = z.string().min(1).parse(input.marketplaceId);
      return requestParsed(
        `/api/v1/marketplaces/${encodeURIComponent(marketplaceId)}`,
        marketplaceRemoveResponseSchema,
        { method: "DELETE" },
      );
    },
    async search(input) {
      const query = z.string().parse(input.query);
      const response = await requestParsed(
        `/api/v1/marketplaces/search?q=${encodeURIComponent(query)}`,
        marketplaceSearchResponseSchema,
      );
      return response.results;
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
        jsonInit("POST", body),
      );
      return response.results;
    },
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
      );
    },
    async getSource(input) {
      return requestParsed(
        pluginPath(input.pluginId, "/source"),
        pluginSourceDetailSchema,
      );
    },
    async install(input) {
      const body = pluginInstallSourceRequestSchema.parse(input);
      const response = await requestParsed(
        "/api/v1/plugins/install",
        pluginInstallResponseSchema,
        jsonInit("POST", body),
      );
      return response.plugin;
    },
    async installFromMarketplace(input) {
      const body = pluginInstallMarketplaceRequestSchema.parse({
        marketplace: {
          marketplaceId: input.marketplaceId,
          entryId: input.entryId,
        },
        ...(input.version === undefined ? {} : { version: input.version }),
      });
      const response = await requestParsed(
        "/api/v1/plugins/install",
        pluginInstallResponseSchema,
        jsonInit("POST", body),
      );
      return response.plugin;
    },
    async list() {
      return requestParsed("/api/v1/plugins", pluginListResponseSchema);
    },
    async listUpdateResults() {
      const response = await requestParsed(
        "/api/v1/plugins/updates",
        pluginUpdateCheckResponseSchema,
      );
      return response.results;
    },
    marketplaces,
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
