import { useQuery, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import {
  toEpochMs,
  type PluginUpdatePolicy,
  PLUGIN_UPDATE_POLICIES,
} from "./plugin-settings-queries";

/**
 * Typed fetchers for the Phase 5 plugin marketplace/update contract:
 * per-plugin source detail, install preview + install, update check/apply,
 * ignore-version, update-policy, and marketplace CRUD/refresh/search. Like
 * plugin-settings-queries, these routes are server-policy glue outside the
 * typed contract, so they are fetched directly and validated locally with
 * injected fetch for tests.
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
    skipped: data.skipped ?? [],
    warnings: data.warnings ?? [],
  };
}

export async function installPlugin(
  fetchImpl: FetchLike,
  request: PluginInstallRequest,
): Promise<void> {
  const response = await fetchImpl("/api/v1/plugins/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (response.ok) return;
  throw new Error(
    errorMessage(
      await readBody(response),
      `installing the plugin failed (HTTP ${response.status})`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Update operations
// ---------------------------------------------------------------------------

/** POST /api/v1/plugins/updates/check — refresh update state (one or all). */
export async function checkPluginUpdates(
  fetchImpl: FetchLike,
  args: { id?: string } = {},
): Promise<void> {
  const response = await fetchImpl("/api/v1/plugins/updates/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args.id === undefined ? {} : { id: args.id }),
  });
  if (response.ok) return;
  throw new Error(
    errorMessage(
      await readBody(response),
      `checking for updates failed (HTTP ${response.status})`,
    ),
  );
}

/** One row of GET /api/v1/plugins/updates (Phase 2 resolution shapes). */
export interface PluginUpdatesEntry {
  id: string;
  /** "current" | "update-available" | "pinned" | "incompatible" | … */
  outcome: string;
  availableVersion: string | null;
  blockedVersion: string | null;
  detail: string | null;
}

const updatesEntrySchema = z.object({
  id: z.string(),
  outcome: z.string(),
  availableVersion: z.string().nullish(),
  blockedVersion: z.string().nullish(),
  detail: z.string().nullish(),
});

/**
 * The bulk update report. The Settings UI drives off the richer per-plugin
 * `updateState` on GET /plugins; this endpoint mirrors `bb plugin outdated`.
 */
export async function fetchPluginUpdates(
  fetchImpl: FetchLike,
): Promise<PluginUpdatesEntry[]> {
  const response = await fetchImpl("/api/v1/plugins/updates");
  if (!response.ok) return [];
  const body = (await readBody(response)) as { updates?: unknown } | null;
  if (!Array.isArray(body?.updates)) return [];
  const entries: PluginUpdatesEntry[] = [];
  for (const value of body.updates) {
    const parsed = updatesEntrySchema.safeParse(value);
    if (!parsed.success) continue;
    entries.push({
      id: parsed.data.id,
      outcome: parsed.data.outcome,
      availableVersion: parsed.data.availableVersion ?? null,
      blockedVersion: parsed.data.blockedVersion ?? null,
      detail: parsed.data.detail ?? null,
    });
  }
  return entries;
}

export interface PluginUpdateResult {
  /** Phase 2 resolution outcome; "rolled-back" means activation failed. */
  outcome: string;
  detail: string | null;
}

/**
 * POST /api/v1/plugins/:id/update. Applies (or dry-runs) the selected
 * update. A "rolled-back" outcome is a resolved value, not a thrown error —
 * the dialog renders it as the failure story.
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
  const typed = body as {
    outcome?: unknown;
    detail?: unknown;
    failure?: { detail?: unknown } | null;
  } | null;
  const outcome = typeof typed?.outcome === "string" ? typed.outcome : "applied";
  const detail =
    typeof typed?.detail === "string"
      ? typed.detail
      : typeof typed?.failure?.detail === "string"
        ? typed.failure.detail
        : null;
  return { outcome, detail };
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
// Marketplaces
// ---------------------------------------------------------------------------

export type MarketplaceScope = "builtin" | "managed" | "user" | "project";

export interface MarketplaceListItem {
  id: string;
  name: string;
  /** builtin/managed render the "official" badge. */
  scope: MarketplaceScope;
  pluginCount: number;
  sourceDisplay: string | null;
  /** Epoch ms of the last successful refresh; null when never refreshed. */
  lastRefreshAt: number | null;
  /** Set when the last refresh failed; the cached catalog stays in use. */
  lastError: string | null;
}

const marketplaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(["builtin", "managed", "user", "project"]).optional(),
  pluginCount: z.number().optional(),
  sourceDisplay: z.string().nullish(),
  lastRefreshAt: z.union([z.number(), z.string()]).nullish(),
  lastError: z.string().nullish(),
});

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
    const parsed = marketplaceSchema.safeParse(value);
    if (!parsed.success) continue;
    const data = parsed.data;
    items.push({
      id: data.id,
      name: data.name,
      scope: data.scope ?? "user",
      pluginCount: data.pluginCount ?? 0,
      sourceDisplay: data.sourceDisplay ?? null,
      lastRefreshAt: toEpochMs(data.lastRefreshAt ?? undefined),
      lastError: data.lastError ?? null,
    });
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

export async function addMarketplace(
  fetchImpl: FetchLike,
  args: { source: string; name?: string },
): Promise<void> {
  const response = await fetchImpl("/api/v1/marketplaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (response.ok) return;
  throw new Error(
    errorMessage(
      await readBody(response),
      `adding the marketplace failed (HTTP ${response.status})`,
    ),
  );
}

export async function refreshMarketplace(
  fetchImpl: FetchLike,
  marketplaceId: string,
): Promise<void> {
  const response = await fetchImpl(
    `/api/v1/marketplaces/${encodeURIComponent(marketplaceId)}/refresh`,
    { method: "POST" },
  );
  if (response.ok) return;
  throw new Error(
    errorMessage(
      await readBody(response),
      `refreshing the marketplace failed (HTTP ${response.status})`,
    ),
  );
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

export async function removeMarketplace(
  fetchImpl: FetchLike,
  marketplaceId: string,
  dispositions: MarketplacePluginDisposition[],
): Promise<void> {
  const response = await fetchImpl(
    `/api/v1/marketplaces/${encodeURIComponent(marketplaceId)}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dispositions }),
    },
  );
  if (response.ok) return;
  const body = await readBody(response);
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
// GET /api/v1/marketplaces/search?q=
// ---------------------------------------------------------------------------

export interface MarketplaceSearchEntry {
  marketplaceId: string;
  marketplaceName: string;
  entryId: string;
  displayName: string;
  description: string | null;
  category: string | null;
  version: string | null;
  /** "npm" | "git" | … — display only. */
  sourceType: string | null;
  /** Set when this entry's plugin id is already installed. */
  installed: boolean;
  /** Human reason the entry can't install here ("requires bb ≥ 0.15"). */
  incompatibleReason: string | null;
}

const searchEntrySchema = z.object({
  marketplaceId: z.string(),
  marketplaceName: z.string().optional(),
  entryId: z.string(),
  displayName: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  version: z.string().nullish(),
  sourceType: z.string().nullish(),
  installed: z.boolean().optional(),
  incompatibleReason: z.string().nullish(),
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
      marketplaceName: data.marketplaceName ?? data.marketplaceId,
      entryId: data.entryId,
      displayName: data.displayName,
      description: data.description ?? null,
      category: data.category ?? null,
      version: data.version ?? null,
      sourceType: data.sourceType ?? null,
      installed: data.installed === true,
      incompatibleReason: data.incompatibleReason ?? null,
    });
  }
  return entries;
}

export function marketplaceSearchQueryKey(query: string): QueryKey {
  return ["marketplace-search", query];
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
