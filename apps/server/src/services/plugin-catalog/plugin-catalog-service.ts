import {
  getInstalledPlugin,
  getPluginCatalog,
  listInstalledPluginsFromCatalog,
  updatePluginCatalogRefreshFailure,
  upsertPluginCatalog,
  type DbConnection,
  type PluginCatalogRow,
} from "@bb/db";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import semver from "semver";
import type {
  InstalledPlugin,
  PluginCatalogSearchResult,
  PluginCatalogStatus,
} from "@bb/server-contract";
import type { PluginService } from "../plugins/plugin-service.js";
import {
  catalogEntrySourceDisplay,
  normalizePersistedPluginCatalog,
  parsePluginCatalog,
  resolvedCatalogEntrySource,
  type PluginCatalog,
  type PluginCatalogEntry,
} from "./catalog.js";
import {
  BUNDLED_PLUGIN_CATALOG,
  OFFICIAL_PLUGIN_CATALOG_URL,
} from "./official-catalog.js";

export const PLUGIN_CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const PLUGIN_CATALOG_FETCH_TIMEOUT_MS = 10_000;
export const PLUGIN_CATALOG_MAX_BODY_BYTES = 1_048_576;

export interface PluginCatalogService {
  status(): PluginCatalogStatus;
  refresh(attemptedAt?: number): Promise<PluginCatalogStatus>;
  search(query: string): PluginCatalogSearchResult[];
  install(entryId: string): Promise<InstalledPlugin>;
  startPeriodicRefresh(): void;
  stopPeriodicRefresh(): void;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

function rowCatalog(row: PluginCatalogRow): PluginCatalog {
  const json: unknown = JSON.parse(row.catalogJson);
  return parsePluginCatalog(json);
}

function statusView(row: PluginCatalogRow): PluginCatalogStatus {
  const catalog = rowCatalog(row);
  return {
    pluginCount: catalog.plugins.length,
    lastRefreshAt: row.lastSuccessfulRefreshAt,
    lastAttemptAt: row.lastAttemptedRefreshAt,
    lastError: row.lastError,
  };
}

function compatibility(
  entry: PluginCatalogEntry,
  appVersion: string,
): string | null {
  const engines = entry.installation?.engines;
  const app = semver.coerce(appVersion);
  if (app === null) return `cannot parse running bb version "${appVersion}"`;
  if (
    engines?.bb !== undefined &&
    app.version !== "0.0.0" &&
    !semver.satisfies(app, engines.bb)
  ) {
    return `requires bb ${engines.bb}, running bb is ${app.version}`;
  }
  if (
    engines?.bbPluginSdk !== undefined &&
    !semver.satisfies(PLUGIN_SDK_VERSION, engines.bbPluginSdk)
  ) {
    return `requires bb plugin SDK ${engines.bbPluginSdk}, running SDK is ${PLUGIN_SDK_VERSION}`;
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return `plugin catalog request timed out after ${PLUGIN_CATALOG_FETCH_TIMEOUT_MS}ms`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > PLUGIN_CATALOG_MAX_BODY_BYTES) {
      await response.body?.cancel();
      throw new Error(
        `plugin catalog response exceeds ${PLUGIN_CATALOG_MAX_BODY_BYTES} bytes`,
      );
    }
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > PLUGIN_CATALOG_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error(
          `plugin catalog response exceeds ${PLUGIN_CATALOG_MAX_BODY_BYTES} bytes`,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function createPluginCatalogService(deps: {
  db: DbConnection;
  appVersion: string;
  plugins: Pick<PluginService, "installFromCatalog" | "isEnabled">;
  notifyCatalogChanged: () => void;
  fetch?: Fetch;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  warn?: (message: string) => void;
}): PluginCatalogService {
  const now = deps.now ?? Date.now;
  const fetchCatalog = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const schedule =
    deps.schedule ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    });

  const existing = getPluginCatalog(deps.db);
  if (existing === undefined) {
    upsertPluginCatalog(deps.db, {
      catalogJson: JSON.stringify(BUNDLED_PLUGIN_CATALOG),
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: null,
      lastAttemptedRefreshAt: null,
      lastError: null,
    });
  } else {
    try {
      const json: unknown = JSON.parse(existing.catalogJson);
      const normalized = normalizePersistedPluginCatalog(json);
      if (normalized.normalizedLegacyShape) {
        upsertPluginCatalog(deps.db, {
          catalogJson: JSON.stringify(normalized.catalog),
          etag: existing.etag,
          lastModified: existing.lastModified,
          lastSuccessfulRefreshAt: existing.lastSuccessfulRefreshAt,
          lastAttemptedRefreshAt: existing.lastAttemptedRefreshAt,
          lastError: existing.lastError,
        });
      }
    } catch (error) {
      upsertPluginCatalog(deps.db, {
        catalogJson: JSON.stringify(BUNDLED_PLUGIN_CATALOG),
        etag: null,
        lastModified: null,
        lastSuccessfulRefreshAt: null,
        lastAttemptedRefreshAt: existing.lastAttemptedRefreshAt,
        lastError: `persisted plugin catalog was invalid; using bundled fallback: ${errorMessage(error)}`,
      });
    }
  }

  let activeRefresh: Promise<PluginCatalogStatus> | null = null;
  let cancelPeriodic: (() => void) | null = null;
  let periodicStopped = true;

  function currentRow(): PluginCatalogRow {
    const row = getPluginCatalog(deps.db);
    if (row === undefined) throw new Error("plugin catalog is not initialized");
    return row;
  }

  async function performRefresh(
    attemptedAt: number,
  ): Promise<PluginCatalogStatus> {
    const before = currentRow();
    const headers = new Headers({ accept: "application/json" });
    if (before.etag !== null) headers.set("if-none-match", before.etag);
    if (before.lastModified !== null) {
      headers.set("if-modified-since", before.lastModified);
    }
    try {
      const response = await fetchCatalog(OFFICIAL_PLUGIN_CATALOG_URL, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(PLUGIN_CATALOG_FETCH_TIMEOUT_MS),
      });
      if (response.status === 304) {
        const refreshed = upsertPluginCatalog(deps.db, {
          catalogJson: before.catalogJson,
          etag: response.headers.get("etag") ?? before.etag,
          lastModified:
            response.headers.get("last-modified") ?? before.lastModified,
          lastSuccessfulRefreshAt: attemptedAt,
          lastAttemptedRefreshAt: attemptedAt,
          lastError: null,
        });
        deps.notifyCatalogChanged();
        return statusView(refreshed);
      }
      if (!response.ok) {
        throw new Error(
          `plugin catalog request failed with HTTP ${response.status}`,
        );
      }
      const raw = await boundedResponseText(response);
      const json: unknown = JSON.parse(raw);
      const catalog = parsePluginCatalog(json);
      const catalogJson = JSON.stringify(catalog);
      const refreshed = upsertPluginCatalog(deps.db, {
        catalogJson,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        lastSuccessfulRefreshAt: attemptedAt,
        lastAttemptedRefreshAt: attemptedAt,
        lastError: null,
      });
      deps.notifyCatalogChanged();
      return statusView(refreshed);
    } catch (error) {
      const message = errorMessage(error);
      updatePluginCatalogRefreshFailure(deps.db, attemptedAt, message);
      deps.notifyCatalogChanged();
      throw new Error(message);
    }
  }

  function coalescedRefresh(attemptedAt: number): Promise<PluginCatalogStatus> {
    if (activeRefresh !== null) return activeRefresh;
    const result = performRefresh(attemptedAt);
    activeRefresh = result;
    void result.then(
      () => {
        if (activeRefresh === result) activeRefresh = null;
      },
      () => {
        if (activeRefresh === result) activeRefresh = null;
      },
    );
    return result;
  }

  function scheduleNextPeriodicRefresh(): void {
    if (periodicStopped) return;
    cancelPeriodic?.();
    const lastAttempt = currentRow().lastAttemptedRefreshAt;
    const delay =
      lastAttempt === null
        ? 0
        : Math.max(
            0,
            PLUGIN_CATALOG_REFRESH_INTERVAL_MS -
              Math.max(0, now() - lastAttempt),
          );
    cancelPeriodic = schedule(runPeriodicRefresh, delay);
  }

  function runPeriodicRefresh(): void {
    if (periodicStopped) return;
    cancelPeriodic = null;
    void coalescedRefresh(now())
      .catch((error: unknown) => {
        deps.warn?.(
          `periodic plugin catalog refresh failed: ${errorMessage(error)}`,
        );
      })
      .finally(scheduleNextPeriodicRefresh);
  }

  return {
    status: () => statusView(currentRow()),

    refresh(attemptedAt = now()) {
      const result = coalescedRefresh(attemptedAt);
      void result.then(
        scheduleNextPeriodicRefresh,
        scheduleNextPeriodicRefresh,
      );
      return result;
    },

    search(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      const catalog = rowCatalog(currentRow());
      const installedEntries = new Set(
        listInstalledPluginsFromCatalog(deps.db)
          .map((plugin) => plugin.catalogEntryId)
          .filter((entry): entry is string => entry !== null),
      );
      return catalog.plugins
        .filter((entry) => {
          if (query.length === 0) return true;
          return [
            entry.id,
            entry.displayName,
            entry.description,
            entry.category ?? "",
          ]
            .join("\n")
            .toLowerCase()
            .includes(query);
        })
        .map((entry): PluginCatalogSearchResult => {
          const problem = compatibility(entry, deps.appVersion);
          return {
            entryId: entry.id,
            displayName: entry.displayName,
            description: entry.description,
            icon: entry.icon ?? null,
            category: entry.category ?? null,
            source: catalogEntrySourceDisplay(entry),
            installed:
              installedEntries.has(entry.id) ||
              getInstalledPlugin(deps.db, entry.id) !== undefined,
            compatible: problem === null,
            incompatibleReason: problem,
          };
        })
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        );
    },

    async install(entryId) {
      if (!deps.plugins.isEnabled()) {
        throw new Error(
          'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
        );
      }
      const entry = rowCatalog(currentRow()).plugins.find(
        (candidate) => candidate.id === entryId,
      );
      if (entry === undefined) {
        throw new Error(`unknown plugin catalog entry "${entryId}"`);
      }
      const resolved = resolvedCatalogEntrySource(entry);
      return deps.plugins.installFromCatalog({
        source: resolved.source,
        entryId,
        installation: entry.installation,
        ...(resolved.npmRegistry === undefined
          ? {}
          : { npmRegistry: resolved.npmRegistry }),
        ...(resolved.gitSubdirectory === undefined
          ? {}
          : { gitSubdirectory: resolved.gitSubdirectory }),
      });
    },

    startPeriodicRefresh() {
      if (!periodicStopped) return;
      periodicStopped = false;
      runPeriodicRefresh();
    },

    stopPeriodicRefresh() {
      periodicStopped = true;
      cancelPeriodic?.();
      cancelPeriodic = null;
    },
  };
}
