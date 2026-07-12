import { useQuery, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import {
  toEpochMs,
  type PluginUpdatePolicy,
  PLUGIN_UPDATE_POLICIES,
} from "./plugin-settings-queries";

/**
 * Typed fetchers for the plugin marketplace/update contract: per-plugin
 * source detail, install preview + install, update check/apply,
 * ignore-version, update-policy, and marketplace CRUD/refresh/search. The
 * marketplace and update shapes mirror the landed Phase 4 server contract
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
// GET /api/v1/plugins/:id/source (Phase 5 sibling endpoint)
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
// POST /api/v1/plugins/install/preview and POST /api/v1/plugins/install
// ---------------------------------------------------------------------------

/** The two install body forms: direct source string or marketplace entry. */
export type PluginInstallRequest =
  | { source: string }
  | {
      marketplace: { marketplaceId: string; entryId: string };
      version?: string;
    };

export interface PluginInstallPreview {
  plugin: { id: string; displayName: string | null; description: string | null } | null;
  resolved: { display: string; version: string | null; commit: string | null };
  compatibility: {
    outcome: "compatible" | "incompatible";
    devMode: boolean;
    problems: string[];
  };
  updatePolicy: PluginUpdatePolicy;
  /** Server-phrased policy line ("tracks compatible releases in ^1.4.0"). */
  updatePolicyDisplay: string | null;
  skipped: { version: string; reason: string }[];
  warnings: string[];
}

const installPreviewSchema = z.object({
  plugin: z
    .object({
      id: z.string(),
      displayName: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  resolved: z.object({
    display: z.string(),
    version: z.string().nullish(),
    commit: z.string().nullish(),
  }),
  compatibility: z.object({
    outcome: z.enum(["compatible", "incompatible"]),
    devMode: z.boolean().optional(),
    problems: z.array(z.string()),
  }),
  updatePolicy: z.enum(PLUGIN_UPDATE_POLICIES),
  // Tolerate absence while the server side lands the amendment.
  updatePolicyDisplay: z.string().nullish(),
  skipped: z
    .array(z.object({ version: z.string(), reason: z.string() }))
    .nullish(),
  warnings: z.array(z.string()).nullish(),
});

/** Resolve + validate without activating. Throws the server's 422 message. */
export async function previewPluginInstall(
  fetchImpl: FetchLike,
  request: PluginInstallRequest,
): Promise<PluginInstallPreview> {
  const response = await fetchImpl("/api/v1/plugins/install/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      errorMessage(body, `previewing the install failed (HTTP ${response.status})`),
    );
  }
  const parsed = installPreviewSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("the server returned an unrecognized install preview");
  }
  const data = parsed.data;
  return {
    plugin:
      data.plugin == null
        ? null
        : {
            id: data.plugin.id,
            displayName: data.plugin.displayName ?? null,
            description: data.plugin.description ?? null,
          },
    resolved: {
      display: data.resolved.display,
      version: data.resolved.version ?? null,
      commit: data.resolved.commit ?? null,
    },
    compatibility: {
      outcome: data.compatibility.outcome,
      devMode: data.compatibility.devMode === true,
      problems: data.compatibility.problems,
    },
    updatePolicy: data.updatePolicy,
    updatePolicyDisplay: data.updatePolicyDisplay ?? null,
    skipped: data.skipped ?? [],
    warnings: data.warnings ?? [],
  };
}

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
// Update operations (Phase 2 contract: plugin-service PluginUpdateCheckEntry
// and applyUpdate result)
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

/** One row of GET/POST /api/v1/plugins/updates[/check] ({ results }). */
export interface PluginUpdatesEntry {
  id: string;
  outcome: PluginUpdatesOutcome;
  devMode: boolean;
  installed: PluginResolvedVersion;
  candidate: PluginResolvedVersion | null;
  blocked: { version: string; reasons: string[] } | null;
  detail: string | null;
  /** Derived: the applicable candidate version, else null. */
  availableVersion: string | null;
  /** Derived: the newer-but-incompatible version, else null. */
  blockedVersion: string | null;
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
  const candidate = data.candidate ?? null;
  const blocked = data.blocked ?? null;
  return {
    id: data.id,
    outcome: data.outcome,
    devMode: data.devMode === true,
    installed: data.installed,
    candidate,
    blocked,
    detail: data.detail ?? null,
    availableVersion:
      data.outcome === "update-available" && candidate !== null
        ? candidate.version
        : null,
    blockedVersion: blocked?.version ?? null,
  };
}

const updatesEnvelopeSchema = z.object({
  results: z.array(updatesEntrySchema),
});

/**
 * The bulk update report ({ results }). The Settings UI drives off the
 * richer per-plugin `updateState` on GET /plugins; this mirrors
 * `bb plugin outdated`.
 */
export async function fetchPluginUpdates(
  fetchImpl: FetchLike,
): Promise<PluginUpdatesEntry[]> {
  const response = await fetchImpl("/api/v1/plugins/updates");
  if (!response.ok) return [];
  const parsed = updatesEnvelopeSchema.safeParse(await readBody(response));
  if (!parsed.success) return [];
  return parsed.data.results.map(toUpdatesEntry);
}

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

export type PluginUpdateApplyOutcome =
  | "current"
  | "update-available"
  | "updated"
  | "rolled-back";

export interface PluginUpdateResult {
  applied: boolean;
  dryRun: boolean;
  outcome: PluginUpdateApplyOutcome;
  from: PluginResolvedVersion;
  to: PluginResolvedVersion | null;
  detail: string | null;
}

const applyResultSchema = z.object({
  applied: z.boolean(),
  dryRun: z.boolean(),
  outcome: z.enum(["current", "update-available", "updated", "rolled-back"]),
  from: resolvedVersionSchema,
  to: resolvedVersionSchema.optional(),
  detail: z.string().optional(),
});

/**
 * POST /api/v1/plugins/:id/update. Applies (or dry-runs) the selected
 * update. A "rolled-back" outcome is a resolved value, not a thrown error —
 * the dialog renders it as the failure story. A 2xx body that doesn't match
 * the contract throws instead of defaulting to success.
 */
export async function applyPluginUpdate(
  fetchImpl: FetchLike,
  pluginId: string,
  args: { dryRun?: boolean; latest?: boolean } = {},
): Promise<PluginUpdateResult> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/update`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
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
    dryRun: parsed.data.dryRun,
    outcome: parsed.data.outcome,
    from: parsed.data.from,
    to: parsed.data.to ?? null,
    detail: parsed.data.detail ?? null,
  };
}

export async function ignorePluginVersion(
  fetchImpl: FetchLike,
  pluginId: string,
  version: string,
): Promise<void> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/ignore-version`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    },
  );
  if (response.ok) return;
  throw new Error(
    errorMessage(
      await readBody(response),
      `ignoring the version failed (HTTP ${response.status})`,
    ),
  );
}

export async function setPluginUpdatePolicy(
  fetchImpl: FetchLike,
  pluginId: string,
  policy: PluginUpdatePolicy,
): Promise<void> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/update-policy`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy }),
    },
  );
  if (response.ok) return;
  throw new Error(
    errorMessage(
      await readBody(response),
      `changing the update policy failed (HTTP ${response.status})`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Marketplaces (Phase 4 contract: marketplace-service MarketplaceView)
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
  enabled: boolean;
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
  enabled: z.boolean(),
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
    enabled: data.enabled,
  };
}

export async function fetchMarketplaces(
  fetchImpl: FetchLike,
): Promise<MarketplaceListItem[]> {
  const response = await fetchImpl("/api/v1/marketplaces");
  // Nothing to list rather than an error: an older server has no catalogs.
  if (!response.ok) return [];
  const body = (await readBody(response)) as { marketplaces?: unknown } | null;
  if (!Array.isArray(body?.marketplaces)) return [];
  const items: MarketplaceListItem[] = [];
  for (const value of body.marketplaces) {
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

export interface MarketplaceAffectedPlugin {
  id: string;
  version: string;
}

export type MarketplacePluginDisposition = {
  pluginId: string;
  action: "keep" | "uninstall";
};

/**
 * DELETE with no dispositions is refused (422) while the marketplace still
 * has installed plugins; the error carries the list so the removal chooser
 * can ask per plugin.
 */
export class MarketplaceRemovalBlockedError extends Error {
  readonly affectedPlugins: MarketplaceAffectedPlugin[];

  constructor(message: string, affectedPlugins: MarketplaceAffectedPlugin[]) {
    super(message);
    this.name = "MarketplaceRemovalBlockedError";
    this.affectedPlugins = affectedPlugins;
  }
}

const affectedPluginsSchema = z.array(
  z.object({ id: z.string(), version: z.string() }),
);

const removeResultSchema = z.object({
  kept: z.array(z.string()),
  uninstalled: z.array(z.string()),
});

export interface MarketplaceRemoveResult {
  kept: string[];
  uninstalled: string[];
}

export async function removeMarketplace(
  fetchImpl: FetchLike,
  marketplaceId: string,
  dispositions: MarketplacePluginDisposition[],
): Promise<MarketplaceRemoveResult> {
  const response = await fetchImpl(
    `/api/v1/marketplaces/${encodeURIComponent(marketplaceId)}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dispositions }),
    },
  );
  const body = await readBody(response);
  if (response.ok) {
    const parsed = removeResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error("the server returned an unrecognized removal result");
    }
    return parsed.data;
  }
  if (response.status === 422) {
    const affected = affectedPluginsSchema.safeParse(
      (body as { affectedPlugins?: unknown } | null)?.affectedPlugins,
    );
    if (affected.success && affected.data.length > 0) {
      throw new MarketplaceRemovalBlockedError(
        errorMessage(body, "the marketplace still has installed plugins"),
        affected.data,
      );
    }
  }
  throw new Error(
    errorMessage(
      body,
      `removing the marketplace failed (HTTP ${response.status})`,
    ),
  );
}

// ---------------------------------------------------------------------------
// GET /api/v1/marketplaces/search?q= (Phase 4 MarketplaceSearchResult)
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
