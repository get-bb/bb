import {
  getInstalledPlugin,
  getPluginMarketplace,
  getPluginMarketplaceIcon,
  listInstalledPlugins,
  recordPluginMarketplaceRefreshFailure,
  replacePluginMarketplaceIcons,
  upsertPluginMarketplace,
  type DbConnection,
  type PluginMarketplaceRow,
} from "@bb/db";
import type {
  InstalledPlugin,
  PluginCatalogSearchResult,
  PluginCatalogStatus,
} from "@bb/server-contract";
import {
  builtinPluginSource,
  listBundledPluginRegistrations,
  PLUGIN_CATALOG_CATEGORIES,
  type BundledPluginRegistration,
} from "../plugins/builtin-registry.js";
import {
  readPluginManifest,
  type PluginManifest,
} from "../plugins/manifest.js";
import type { PluginService } from "../plugins/plugin-service.js";
import { evaluateCompatibility } from "../plugins/update-resolver.js";
import { fetchMarketplaceIcons } from "./marketplace-icons.js";
import {
  boundedResponseBytes,
  marketplaceErrorMessage,
  publicMarketplaceFetch,
  MARKETPLACE_FETCH_TIMEOUT_MS,
  type MarketplaceFetch,
} from "./marketplace-http.js";
import {
  entryIconName,
  entrySourceDisplay,
  OFFICIAL_MARKETPLACE_NAME,
  parseMarketplaceManifestJson,
  resolvedEntrySource,
  type MarketplaceEntry,
  type MarketplaceManifest,
} from "./marketplace-manifest.js";
import { BUNDLED_OFFICIAL_MARKETPLACE } from "./official-marketplace.js";

const MARKETPLACE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MARKETPLACE_MANIFEST_MAX_BYTES = 1_048_576;

interface PluginCatalogIcon {
  bytes: Buffer;
  contentType: string;
  hash: string;
}

export interface PluginCatalogService {
  status(): PluginCatalogStatus;
  /**
   * Conditionally re-read the official manifest and its icons. Discovery
   * metadata only: a refresh never installs, updates, or runs plugin code.
   * Rejects when the attempt failed; the last-known-good catalog stays.
   */
  refresh(attemptedAt?: number): Promise<void>;
  search(query: string): Promise<PluginCatalogSearchResult[]>;
  install(entryId: string): Promise<InstalledPlugin>;
  /** Cached bytes behind GET /plugin-catalog/icons/:marketplace/:entryId. */
  icon(marketplace: string, entryId: string): PluginCatalogIcon | undefined;
  startPeriodicRefresh(): void;
  stopPeriodicRefresh(): void;
}

/**
 * The plugin store over the official plugins bundled with the app plus the
 * BB Official marketplace catalog. Bundled entries install from the local
 * bundled copy — no network, no catalog row; installed plugins update by
 * riding app releases. Marketplace entries come from a validated
 * last-known-good catalog and install from their listed source with catalog
 * provenance, so they trace back to the marketplace that listed them.
 */
export function createPluginCatalogService(deps: {
  db: DbConnection;
  appVersion: string;
  /** Manifest URL of the official marketplace (BB_MARKETPLACE_URL). */
  marketplaceUrl: string;
  plugins: Pick<
    PluginService,
    "installOfficialPlugin" | "installCatalogPlugin"
  >;
  bundledPlugins?: readonly BundledPluginRegistration[];
  fetch?: MarketplaceFetch;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  notifyCatalogChanged?: () => void;
  warn?: (message: string) => void;
}): PluginCatalogService {
  const bundledPlugins =
    deps.bundledPlugins ?? listBundledPluginRegistrations();
  const officialPlugins = bundledPlugins.map((plugin) => ({
    ...plugin,
    category: plugin.category ?? "Other",
  }));
  const categoryOrder = new Map<string, number>(
    PLUGIN_CATALOG_CATEGORIES.map((category, index) => [category, index]),
  );
  // The Browse tab groups by the curated tag vocabulary: the catalog's own
  // categories, lowercased and kebab-cased. Other tags stay searchable but do
  // not create sections.
  const categoryByTag = new Map<string, string>(
    PLUGIN_CATALOG_CATEGORIES.map((category) => [
      category
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, ""),
      category,
    ]),
  );
  const now = deps.now ?? Date.now;
  // Manifests and entry icons share one guarded socket: https on port 443, no
  // credentials, no redirects, and a DNS answer that must route only through
  // the public internet. An entry can name any icon URL, so the icon fetch
  // needs the same protection as the manifest fetch.
  const fetchMarketplace = deps.fetch ?? publicMarketplaceFetch;
  const schedule =
    deps.schedule ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    });

  seedOfficialMarketplace();

  let activeRefresh: Promise<void> | null = null;
  let cancelPeriodic: (() => void) | null = null;
  let periodicStopped = true;

  /**
   * Guarantee a parseable last-known-good row before anything reads it. A
   * stored catalog that no longer parses (a downgrade, a corrupt write) or one
   * fetched from a different manifest URL falls back to the bundled snapshot
   * rather than leaving the store empty.
   */
  function seedOfficialMarketplace(): void {
    const existing = getPluginMarketplace(deps.db, OFFICIAL_MARKETPLACE_NAME);
    if (
      existing !== undefined &&
      existing.manifestUrl === deps.marketplaceUrl
    ) {
      try {
        parseMarketplaceManifestJson(
          existing.manifestJson,
          "stored marketplace catalog",
        );
        return;
      } catch (error) {
        deps.warn?.(
          `stored ${OFFICIAL_MARKETPLACE_NAME} catalog was rejected; using the bundled snapshot: ${marketplaceErrorMessage(error)}`,
        );
      }
    }
    upsertPluginMarketplace(deps.db, {
      name: OFFICIAL_MARKETPLACE_NAME,
      manifestUrl: deps.marketplaceUrl,
      manifestJson: JSON.stringify(BUNDLED_OFFICIAL_MARKETPLACE),
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: null,
      lastAttemptedRefreshAt: existing?.lastAttemptedRefreshAt ?? null,
      lastError: null,
    });
  }

  function currentRow(): PluginMarketplaceRow {
    const row = getPluginMarketplace(deps.db, OFFICIAL_MARKETPLACE_NAME);
    if (row === undefined) {
      throw new Error(
        `marketplace "${OFFICIAL_MARKETPLACE_NAME}" is not initialized`,
      );
    }
    return row;
  }

  function currentCatalog(): MarketplaceManifest {
    return parseMarketplaceManifestJson(
      currentRow().manifestJson,
      "stored marketplace catalog",
    );
  }

  function compatibilityProblem(ranges: {
    bbRange: string | undefined;
    sdkRange: string | undefined;
  }): string | null {
    const compatibility = evaluateCompatibility({
      bbRange: ranges.bbRange,
      sdkRange: ranges.sdkRange,
      appVersion: deps.appVersion,
    });
    return compatibility.effective.length === 0
      ? null
      : compatibility.effective.map((problem) => problem.message).join("; ");
  }

  // Manifests are read per search so a dev checkout editing a bundled
  // plugin's package.json sees fresh store metadata; this small local catalog
  // is cheap enough not to cache.
  function entryManifest(
    entry: BundledPluginRegistration,
  ): Promise<PluginManifest | null> {
    return readPluginManifest(entry.rootDir).catch((error: unknown) => {
      deps.warn?.(
        `official plugin ${entry.name} is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    });
  }

  function bundledSearchResult(
    entry: { name: string; pluginId: string; category: string },
    manifest: PluginManifest,
  ): PluginCatalogSearchResult {
    const problem = compatibilityProblem({
      bbRange: manifest.bbEngineRange,
      sdkRange: manifest.bbPluginSdkRange,
    });
    return {
      entryId: entry.name,
      pluginId: entry.pluginId,
      displayName: manifest.name,
      description: manifest.description,
      icon: manifest.branding.icon ?? null,
      iconUrl: null,
      category: entry.category,
      source: builtinPluginSource(entry.name),
      installed: getInstalledPlugin(deps.db, entry.pluginId) !== undefined,
      compatible: problem === null,
      incompatibleReason: problem,
    };
  }

  function entryCategory(entry: MarketplaceEntry): string {
    for (const tag of entry.tags ?? []) {
      const category = categoryByTag.get(tag);
      if (category !== undefined) return category;
    }
    return "Other";
  }

  function entryIconUrl(entryId: string): string | null {
    const icon = getPluginMarketplaceIcon(
      deps.db,
      OFFICIAL_MARKETPLACE_NAME,
      entryId,
    );
    return icon === undefined
      ? null
      : `/api/v1/plugin-catalog/icons/${encodeURIComponent(OFFICIAL_MARKETPLACE_NAME)}/${encodeURIComponent(entryId)}?h=${icon.contentHash}`;
  }

  function catalogSearchResult(
    entry: MarketplaceEntry,
    installedEntryIds: ReadonlySet<string>,
  ): PluginCatalogSearchResult {
    const problem = compatibilityProblem({
      bbRange: entry.engines?.bb,
      sdkRange: entry.engines?.bbPluginSdk,
    });
    return {
      entryId: entry.id,
      // An entry id is the plugin id it installs; the install aborts when the
      // fetched manifest declares another one.
      pluginId: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      icon: entryIconName(entry),
      iconUrl: entryIconUrl(entry.id),
      category: entryCategory(entry),
      source: entrySourceDisplay(entry),
      installed:
        installedEntryIds.has(entry.id) ||
        getInstalledPlugin(deps.db, entry.id) !== undefined,
      compatible: problem === null,
      incompatibleReason: problem,
    };
  }

  async function performRefresh(attemptedAt: number): Promise<void> {
    const before = currentRow();
    const headers = new Headers({ accept: "application/json" });
    if (before.etag !== null) headers.set("if-none-match", before.etag);
    if (before.lastModified !== null) {
      headers.set("if-modified-since", before.lastModified);
    }
    try {
      const response = await fetchMarketplace(before.manifestUrl, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS),
      });
      const unchanged = response.status === 304;
      if (!unchanged && !response.ok) {
        await response.body?.cancel();
        throw new Error(`request failed with HTTP ${response.status}`);
      }
      let manifestJson = before.manifestJson;
      let catalog: MarketplaceManifest;
      if (unchanged) {
        await response.body?.cancel();
        catalog = parseMarketplaceManifestJson(
          manifestJson,
          "stored marketplace catalog",
        );
      } else {
        const raw = new TextDecoder().decode(
          await boundedResponseBytes(
            response,
            MARKETPLACE_MANIFEST_MAX_BYTES,
            "marketplace manifest",
          ),
        );
        catalog = parseMarketplaceManifestJson(raw, "marketplace manifest");
        if (catalog.name !== OFFICIAL_MARKETPLACE_NAME) {
          throw new Error(
            `invalid marketplace manifest: expected name "${OFFICIAL_MARKETPLACE_NAME}", got ${JSON.stringify(catalog.name)}`,
          );
        }
        manifestJson = JSON.stringify(catalog);
      }
      // An unchanged manifest still retries entries whose icon never cached,
      // so one bad icon fetch is not permanent.
      const icons = await fetchMarketplaceIcons({
        db: deps.db,
        marketplaceName: OFFICIAL_MARKETPLACE_NAME,
        manifestUrl: before.manifestUrl,
        entries: catalog.plugins,
        onlyMissing: unchanged,
        fetch: fetchMarketplace,
        ...(deps.warn === undefined ? {} : { warn: deps.warn }),
      });
      // The catalog and all icon rows form one snapshot. Network work happens
      // first, then SQLite publishes the complete snapshot in one commit.
      deps.db.transaction((tx) => {
        upsertPluginMarketplace(tx, {
          name: OFFICIAL_MARKETPLACE_NAME,
          manifestUrl: before.manifestUrl,
          manifestJson,
          etag:
            response.headers.get("etag") ?? (unchanged ? before.etag : null),
          lastModified:
            response.headers.get("last-modified") ??
            (unchanged ? before.lastModified : null),
          lastSuccessfulRefreshAt: attemptedAt,
          lastAttemptedRefreshAt: attemptedAt,
          lastError: null,
        });
        replacePluginMarketplaceIcons(tx, OFFICIAL_MARKETPLACE_NAME, icons);
      });
      deps.notifyCatalogChanged?.();
    } catch (error) {
      const message = marketplaceErrorMessage(error);
      recordPluginMarketplaceRefreshFailure(
        deps.db,
        OFFICIAL_MARKETPLACE_NAME,
        attemptedAt,
        message,
      );
      throw new Error(message);
    }
  }

  function coalescedRefresh(attemptedAt: number): Promise<void> {
    if (activeRefresh !== null) return activeRefresh;
    const result = performRefresh(attemptedAt);
    activeRefresh = result;
    const clear = () => {
      if (activeRefresh === result) activeRefresh = null;
    };
    void result.then(clear, clear);
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
            MARKETPLACE_REFRESH_INTERVAL_MS - Math.max(0, now() - lastAttempt),
          );
    cancelPeriodic = schedule(runPeriodicRefresh, delay);
  }

  function runPeriodicRefresh(): void {
    if (periodicStopped) return;
    cancelPeriodic = null;
    void coalescedRefresh(now())
      .catch((error: unknown) => {
        deps.warn?.(
          `periodic ${OFFICIAL_MARKETPLACE_NAME} catalog refresh failed: ${marketplaceErrorMessage(error)}`,
        );
      })
      .finally(scheduleNextPeriodicRefresh);
  }

  return {
    status() {
      const catalog = currentCatalog();
      return {
        pluginCount: bundledPlugins.length + catalog.plugins.length,
        includedPluginCount: bundledPlugins.filter(
          (plugin) => plugin.autoInstall,
        ).length,
        optionalPluginCount:
          bundledPlugins.filter((plugin) => !plugin.autoInstall).length +
          catalog.plugins.length,
      };
    },

    refresh(attemptedAt = now()) {
      const result = coalescedRefresh(attemptedAt);
      void result.then(
        scheduleNextPeriodicRefresh,
        scheduleNextPeriodicRefresh,
      );
      return result;
    },

    icon(marketplace, entryId) {
      const row = getPluginMarketplaceIcon(deps.db, marketplace, entryId);
      return row === undefined
        ? undefined
        : {
            bytes: row.bytes,
            contentType: row.contentType,
            hash: row.contentHash,
          };
    },

    async search(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      const bundledEntries = await Promise.all(
        officialPlugins.map(async (entry) => {
          const manifest = await entryManifest(entry);
          return manifest === null
            ? null
            : {
                pluginId: entry.pluginId,
                tags: [] as string[],
                result: bundledSearchResult(entry, manifest),
              };
        }),
      );
      const installedEntryIds = new Set(
        listInstalledPlugins(deps.db)
          .filter(
            (row) => row.catalogMarketplaceName === OFFICIAL_MARKETPLACE_NAME,
          )
          .map((row) => row.catalogEntryId)
          .filter((entryId): entryId is string => entryId !== null),
      );
      const catalogEntries = currentCatalog().plugins.map((entry) => ({
        pluginId: entry.id,
        tags: entry.tags ?? [],
        result: catalogSearchResult(entry, installedEntryIds),
      }));
      return [...bundledEntries, ...catalogEntries]
        .filter((entry) => entry !== null)
        .filter(
          (entry) =>
            query.length === 0 ||
            [
              entry.result.entryId,
              entry.pluginId,
              entry.result.displayName,
              entry.result.description,
              entry.result.category,
              ...entry.tags,
            ]
              .join("\n")
              .toLowerCase()
              .includes(query),
        )
        .map(({ result }) => result)
        .sort((left, right) => {
          const categoryDifference =
            (categoryOrder.get(left.category) ?? categoryOrder.size) -
            (categoryOrder.get(right.category) ?? categoryOrder.size);
          return (
            categoryDifference ||
            left.displayName.localeCompare(right.displayName)
          );
        });
    },

    async install(entryId) {
      const catalogEntry = currentCatalog().plugins.find(
        (candidate) => candidate.id === entryId,
      );
      if (catalogEntry !== undefined) {
        // The UI disables incompatible entries, but the server owns the
        // policy: refuse direct installs the store would not offer.
        const problem = compatibilityProblem({
          bbRange: catalogEntry.engines?.bb,
          sdkRange: catalogEntry.engines?.bbPluginSdk,
        });
        if (problem !== null) {
          throw new Error(`install refused: ${problem}`);
        }
        const resolved = resolvedEntrySource(catalogEntry);
        return deps.plugins.installCatalogPlugin({
          marketplace: OFFICIAL_MARKETPLACE_NAME,
          entryId: catalogEntry.id,
          pluginId: catalogEntry.id,
          source: resolved.source,
          selection: resolved.selection,
          ...(catalogEntry.engines === undefined
            ? {}
            : { engines: catalogEntry.engines }),
          ...(resolved.npmRegistry === undefined
            ? {}
            : { npmRegistry: resolved.npmRegistry }),
        });
      }
      const entry = officialPlugins.find(
        (candidate) => candidate.name === entryId,
      );
      if (entry === undefined) {
        throw new Error(`unknown plugin catalog entry "${entryId}"`);
      }
      const manifest = await entryManifest(entry);
      if (manifest === null) {
        throw new Error(
          `official plugin "${entryId}" is unavailable in this build`,
        );
      }
      const problem = compatibilityProblem({
        bbRange: manifest.bbEngineRange,
        sdkRange: manifest.bbPluginSdkRange,
      });
      if (problem !== null) {
        throw new Error(`install refused: ${problem}`);
      }
      return deps.plugins.installOfficialPlugin(entry.name);
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
