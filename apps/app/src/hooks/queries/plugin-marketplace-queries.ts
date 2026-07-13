import { useQuery, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import { toEpochMs } from "./plugin-settings-queries";

/**
 * Typed fetchers for the manual-updates plugin marketplace contract:
 * per-plugin source detail, install, update check/apply, and marketplace
 * CRUD/refresh/search. The shapes mirror the landed server contract
 * (apps/server marketplace-service MarketplaceView/MarketplaceSearchResult
 * and plugin-service PluginUpdateCheckEntry/applyUpdate) exactly; success
 * responses are validated at this boundary so a drifted server never
 * renders as success UI. Fetchers take an injected fetch for tests.
 */

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

async function readBody(
  response: Pick<Response, "json">,
): Promise<unknown | null> {
  return (await response.json().catch(() => null)) as unknown | null;
}

function errorMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}

// ---------------------------------------------------------------------------
// GET /api/v1/plugins/:id/source
// ---------------------------------------------------------------------------

export interface PluginSourceDetail {
  requested: string;
  resolved: string;
  integrity: string | null;
  registry: string | null;
  engines: { bb: string | null; bbPluginSdk: string | null };
  /** Epoch ms; null when unknown. */
  installedAt: number | null;
  history: { version: string; activatedAt: number | null }[];
}

const pluginSourceSchema = z.object({
  requested: z.string(),
  resolved: z.string(),
  integrity: z.string().nullish(),
  registry: z.string().nullish(),
  engines: z
    .object({
      bb: z.string().nullish(),
      bbPluginSdk: z.string().nullish(),
    })
    .optional(),
  installedAt: z.union([z.number(), z.string()]).nullish(),
  history: z
    .array(
      z.object({
        version: z.string(),
        activatedAt: z.union([z.number(), z.string()]).nullish(),
      }),
    )
    .optional(),
});

/** Null when the plugin is unknown or the server predates the route. */
export async function fetchPluginSource(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<PluginSourceDetail | null> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/source`,
  );
  if (!response.ok) return null;
  const parsed = pluginSourceSchema.safeParse(await readBody(response));
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    requested: data.requested,
    resolved: data.resolved,
    integrity: data.integrity ?? null,
    registry: data.registry ?? null,
    engines: {
      bb: data.engines?.bb ?? null,
      bbPluginSdk: data.engines?.bbPluginSdk ?? null,
    },
    installedAt: toEpochMs(data.installedAt ?? undefined),
    history: (data.history ?? []).map((entry) => ({
      version: entry.version,
      activatedAt: toEpochMs(entry.activatedAt ?? undefined),
    })),
  };
}

export function pluginSourceQueryKey(pluginId: string): QueryKey {
  return ["plugin-source", pluginId];
}

/** Prefix the realtime `plugins-changed` broadcast invalidates. */
export function allPluginSourceQueryKeyPrefix(): QueryKey {
  return ["plugin-source"];
}

export function usePluginSource(
  pluginId: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: pluginSourceQueryKey(pluginId),
    queryFn: () => fetchPluginSource(fetch, pluginId),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/plugins/install
// ---------------------------------------------------------------------------

/** The two install body forms: direct source string or marketplace entry. */
export type PluginInstallRequest =
  | { source: string }
  | {
      marketplace: { marketplaceId: string; entryId: string };
      version?: string;
    };

const installResultSchema = z.object({ ok: z.literal(true) });

export async function installPlugin(
  fetchImpl: FetchLike,
  request: PluginInstallRequest,
): Promise<void> {
  const response = await fetchImpl("/api/v1/plugins/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(body, `installing the plugin failed (HTTP ${response.status})`),
    );
  }
  if (!installResultSchema.safeParse(body).success) {
    throw new Error("the server returned an unrecognized install result");
  }
}

// ---------------------------------------------------------------------------
// Update operations (plugin-service PluginUpdateCheckEntry and applyUpdate)
// ---------------------------------------------------------------------------

export interface PluginResolvedVersion {
  /** Exact npm version or git commit. */
  version: string;
  display: string;
}

const resolvedVersionSchema = z.object({
  version: z.string(),
  display: z.string(),
});

export type PluginUpdatesOutcome =
  | "current"
  | "update-available"
  | "pinned"
  | "incompatible"
  | "unavailable";

/** One row of POST /api/v1/plugins/updates/check ({ results }). */
export interface PluginUpdatesEntry {
  id: string;
  outcome: PluginUpdatesOutcome;
  devMode: boolean;
  installed: PluginResolvedVersion;
  candidate: PluginResolvedVersion | null;
  blocked: { version: string; reasons: string[] } | null;
  detail: string | null;
}

const updatesEntrySchema = z.object({
  id: z.string(),
  outcome: z.enum([
    "current",
    "update-available",
    "pinned",
    "incompatible",
    "unavailable",
  ]),
  devMode: z.literal(true).optional(),
  installed: resolvedVersionSchema,
  candidate: resolvedVersionSchema.optional(),
  blocked: z
    .object({ version: z.string(), reasons: z.array(z.string()) })
    .optional(),
  detail: z.string().optional(),
});

function toUpdatesEntry(
  data: z.infer<typeof updatesEntrySchema>,
): PluginUpdatesEntry {
  return {
    id: data.id,
    outcome: data.outcome,
    devMode: data.devMode === true,
    installed: data.installed,
    candidate: data.candidate ?? null,
    blocked: data.blocked ?? null,
    detail: data.detail ?? null,
  };
}

const updatesEnvelopeSchema = z.object({
  results: z.array(updatesEntrySchema),
});

/**
 * POST /api/v1/plugins/updates/check — refresh update state for one or all
 * plugins. Returns the checked entries; throws when the response doesn't
 * match the contract so a drifted server never reads as a clean check.
 */
export async function checkPluginUpdates(
  fetchImpl: FetchLike,
  args: { id?: string } = {},
): Promise<PluginUpdatesEntry[]> {
  const response = await fetchImpl("/api/v1/plugins/updates/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args.id === undefined ? {} : { id: args.id }),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(body, `checking for updates failed (HTTP ${response.status})`),
    );
  }
  const parsed = updatesEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("the server returned an unrecognized update-check result");
  }
  return parsed.data.results.map(toUpdatesEntry);
}

export interface PluginUpdateResult {
  applied: boolean;
  outcome: string;
  from: PluginResolvedVersion;
  to: PluginResolvedVersion | null;
  detail: string | null;
}

const applyResultSchema = z.object({
  applied: z.boolean(),
  outcome: z.string(),
  from: resolvedVersionSchema,
  to: resolvedVersionSchema.optional(),
  detail: z.string().optional(),
});

/**
 * POST /api/v1/plugins/:id/update (empty body). Applies the selected
 * update. A "rolled-back" outcome is a resolved value, not a thrown error —
 * the dialog renders it as the failure story. A 2xx body that doesn't match
 * the contract throws instead of defaulting to success.
 */
export async function applyPluginUpdate(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<PluginUpdateResult> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/update`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(body, `updating the plugin failed (HTTP ${response.status})`),
    );
  }
  const parsed = applyResultSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("the server returned an unrecognized update result");
  }
  return {
    applied: parsed.data.applied,
    outcome: parsed.data.outcome,
    from: parsed.data.from,
    to: parsed.data.to ?? null,
    detail: parsed.data.detail ?? null,
  };
}

// ---------------------------------------------------------------------------
// Marketplaces (marketplace-service MarketplaceView)
// ---------------------------------------------------------------------------

export interface MarketplaceListItem {
  /** Stable ID; `name` mirrors it in the wire view. */
  id: string;
  name: string;
  displayName: string;
  /** Human source line ("github.com/acme/bb-marketplace@main" or a path). */
  source: string;
  /** Exact commit for git-backed catalogs; null for path catalogs. */
  resolvedCommit: string | null;
  pluginCount: number;
  /** Epoch ms of the last successful refresh; null when never refreshed. */
  lastRefreshAt: number | null;
  lastAttemptAt: number | null;
  /** Set when the last refresh failed; the cached catalog stays in use. */
  lastError: string | null;
}

const marketplaceViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  source: z.string(),
  resolvedCommit: z.string().optional(),
  pluginCount: z.number(),
  lastRefreshAt: z.number().optional(),
  lastAttemptAt: z.number().optional(),
  lastError: z.string().optional(),
});

function toMarketplaceListItem(
  data: z.infer<typeof marketplaceViewSchema>,
): MarketplaceListItem {
  return {
    id: data.id,
    name: data.name,
    displayName: data.displayName,
    source: data.source,
    resolvedCommit: data.resolvedCommit ?? null,
    pluginCount: data.pluginCount,
    lastRefreshAt: data.lastRefreshAt ?? null,
    lastAttemptAt: data.lastAttemptAt ?? null,
    lastError: data.lastError ?? null,
  };
}

const marketplacesEnvelopeSchema = z.object({
  marketplaces: z.array(z.unknown()),
});

export async function fetchMarketplaces(
  fetchImpl: FetchLike,
): Promise<MarketplaceListItem[]> {
  const response = await fetchImpl("/api/v1/marketplaces");
  // Nothing to list rather than an error: an older server has no catalogs.
  if (!response.ok) return [];
  const envelope = marketplacesEnvelopeSchema.safeParse(
    await readBody(response),
  );
  if (!envelope.success) return [];
  const items: MarketplaceListItem[] = [];
  for (const value of envelope.data.marketplaces) {
    const parsed = marketplaceViewSchema.safeParse(value);
    if (parsed.success) items.push(toMarketplaceListItem(parsed.data));
  }
  return items;
}

export function marketplacesQueryKey(): QueryKey {
  return ["marketplaces"];
}

export function useMarketplaces(options: { enabled: boolean }) {
  return useQuery({
    queryKey: marketplacesQueryKey(),
    queryFn: () => fetchMarketplaces(fetch),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}

const marketplaceEnvelopeSchema = z.object({
  marketplace: marketplaceViewSchema,
});

export async function addMarketplace(
  fetchImpl: FetchLike,
  args: { source: string; name?: string },
): Promise<MarketplaceListItem> {
  const response = await fetchImpl("/api/v1/marketplaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(body, `adding the marketplace failed (HTTP ${response.status})`),
    );
  }
  const parsed = marketplaceEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("the server returned an unrecognized marketplace");
  }
  return toMarketplaceListItem(parsed.data.marketplace);
}

export async function refreshMarketplace(
  fetchImpl: FetchLike,
  marketplaceId: string,
): Promise<MarketplaceListItem> {
  const response = await fetchImpl(
    `/api/v1/marketplaces/${encodeURIComponent(marketplaceId)}/refresh`,
    { method: "POST" },
  );
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(
        body,
        `refreshing the marketplace failed (HTTP ${response.status})`,
      ),
    );
  }
  const parsed = marketplaceEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("the server returned an unrecognized marketplace");
  }
  return toMarketplaceListItem(parsed.data.marketplace);
}

const removeResultSchema = z.object({
  convertedPluginIds: z.array(z.string()),
});

export interface MarketplaceRemoveResult {
  /** Installed plugins the removal converted to direct installs. */
  convertedPluginIds: string[];
}

/**
 * DELETE /api/v1/marketplaces/:id (no body). Removal never uninstalls:
 * installed plugins from the catalog become direct installs, echoed back as
 * `convertedPluginIds`.
 */
export async function removeMarketplace(
  fetchImpl: FetchLike,
  marketplaceId: string,
): Promise<MarketplaceRemoveResult> {
  const response = await fetchImpl(
    `/api/v1/marketplaces/${encodeURIComponent(marketplaceId)}`,
    { method: "DELETE" },
  );
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(
        body,
        `removing the marketplace failed (HTTP ${response.status})`,
      ),
    );
  }
  const parsed = removeResultSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("the server returned an unrecognized removal result");
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// GET /api/v1/marketplaces/search?q= (MarketplaceSearchResult)
// ---------------------------------------------------------------------------

export interface MarketplaceSearchEntry {
  marketplaceId: string;
  entryId: string;
  displayName: string;
  description: string;
  category: string | null;
  /** Human source line for the catalog entry (npm package or git URL). */
  source: string;
  /** True when this entry's plugin id is already installed. */
  installed: boolean;
  /** Install gating: false disables Install regardless of reason text. */
  compatible: boolean;
  /** Human reason the entry can't install here ("requires bb >= 0.15"). */
  incompatibleReason: string | null;
}

const searchEntrySchema = z.object({
  marketplaceId: z.string(),
  entryId: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: z.string().optional(),
  source: z.string(),
  installed: z.boolean(),
  compatible: z.boolean(),
  incompatibleReason: z.string().optional(),
});

export async function searchMarketplaces(
  fetchImpl: FetchLike,
  query: string,
): Promise<MarketplaceSearchEntry[]> {
  const response = await fetchImpl(
    `/api/v1/marketplaces/search?q=${encodeURIComponent(query)}`,
  );
  if (!response.ok) return [];
  const body = (await readBody(response)) as { results?: unknown } | null;
  if (!Array.isArray(body?.results)) return [];
  const entries: MarketplaceSearchEntry[] = [];
  for (const value of body.results) {
    const parsed = searchEntrySchema.safeParse(value);
    if (!parsed.success) continue;
    const data = parsed.data;
    entries.push({
      marketplaceId: data.marketplaceId,
      entryId: data.entryId,
      displayName: data.displayName,
      description: data.description,
      category: data.category ?? null,
      source: data.source,
      installed: data.installed,
      compatible: data.compatible,
      incompatibleReason: data.incompatibleReason ?? null,
    });
  }
  return entries;
}

export function marketplaceSearchQueryKey(query: string): QueryKey {
  return ["marketplace-search", query];
}

/** Prefix invalidated when catalogs or installed plugins change. */
export function allMarketplaceSearchQueryKeyPrefix(): QueryKey {
  return ["marketplace-search"];
}

export function useMarketplaceSearch(
  query: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: marketplaceSearchQueryKey(query),
    queryFn: () => searchMarketplaces(fetch, query),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}
