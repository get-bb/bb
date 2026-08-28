import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  deletePluginMarketplace,
  getInstalledPlugin,
  getPluginMarketplace,
  getPluginMarketplaceIcon,
  listInstalledPlugins,
  listInstalledPluginsFromMarketplace,
  listPluginMarketplaces,
  recordPluginMarketplaceRefreshFailure,
  replacePluginMarketplaceIcons,
  setInstalledPluginDirectProvenance,
  upsertPluginMarketplace,
  type DbConnection,
  type PluginMarketplaceRow,
} from "@bb/db";
import type {
  InstalledPlugin,
  PluginCatalogAuthor,
  PluginCatalogInstallPlan,
  PluginCatalogResolvedSource,
  PluginCatalogSearchResult,
  PluginCatalogStatus,
  PluginMarketplace,
  PluginMarketplaceRefreshResult,
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
import {
  evaluateCompatibility,
  listGitSemverTags,
  resolveGitRef,
  selectGitSemverTag,
} from "../plugins/update-resolver.js";
import { fetchMarketplaceIcons } from "./marketplace-icons.js";
import {
  fetchMarketplaceStats,
  installCountsFromStatsJson,
} from "./marketplace-stats.js";
import {
  marketplaceErrorMessage,
  publicMarketplaceFetch,
  type MarketplaceFetch,
} from "./marketplace-http.js";
import {
  BUILTIN_PUBLISHER_KEY,
  BUILTIN_PUBLISHER_LABEL,
  entryIconName,
  entryIconTinted,
  entryRepositoryUrl,
  entrySourceDisplay,
  CURATED_MARKETPLACE_NAME,
  parseMarketplaceManifestJson,
  resolvedEntrySource,
  type MarketplaceEntry,
  type MarketplaceManifest,
} from "./marketplace-manifest.js";
import {
  marketplaceSourceColumns,
  marketplaceSourceDisplay,
  marketplaceSourceFromRow,
  materializeMarketplace,
  parseMarketplaceSource,
} from "./marketplace-source.js";
import { BUNDLED_CURATED_MARKETPLACE } from "./curated-marketplace.js";
import { marketplacePublisherLabel } from "./marketplace-publishers.js";

const MARKETPLACE_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1_000;

const BUNDLED_ICON_CONTENT_TYPE = "image/svg+xml";

interface PluginCatalogIcon {
  bytes: Buffer;
  contentType: string;
  hash: string;
}

export interface PluginCatalogEntrySelector {
  entryId: string;
  marketplace?: string;
}

interface PluginCatalogInstallInput extends PluginCatalogEntrySelector {
  confirmedSource?: PluginCatalogResolvedSource;
}

export interface PluginCatalogService {
  status(): PluginCatalogStatus;
  refresh(attemptedAt?: number): Promise<void>;
  refreshMarketplaces(args?: {
    name?: string;
    attemptedAt?: number;
  }): Promise<PluginMarketplaceRefreshResult[]>;
  search(query: string): Promise<PluginCatalogSearchResult[]>;
  installPlan(
    selector: PluginCatalogEntrySelector,
  ): Promise<PluginCatalogInstallPlan>;
  install(input: PluginCatalogInstallInput): Promise<InstalledPlugin>;
  icon(
    marketplace: string,
    entryId: string,
  ): Promise<PluginCatalogIcon | undefined>;
  listMarketplaces(): PluginMarketplace[];
  addMarketplace(source: string): Promise<PluginMarketplace>;
  removeMarketplace(name: string): Promise<{ convertedPluginIds: string[] }>;
  startPeriodicRefresh(): void;
  stopPeriodicRefresh(): void;
}

type ResolvedCatalogEntry =
  | { kind: "marketplace"; row: PluginMarketplaceRow; entry: MarketplaceEntry }
  | {
      kind: "bundled";
      entry: BundledPluginRegistration & { category: string };
    };

export function createPluginCatalogService(deps: {
  db: DbConnection;
  appVersion: string;
  marketplaceUrl: string;
  dataDir: string;
  plugins: Pick<
    PluginService,
    "installOfficialPlugin" | "installCatalogPlugin" | "resolveCatalogNpmSource"
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
  const fetchMarketplace = deps.fetch ?? publicMarketplaceFetch;
  const schedule =
    deps.schedule ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    });
  const stagingDir = join(deps.dataDir, "marketplaces", "staging");
  let stagingReady: Promise<void> | null = null;

  function prepareMarketplaceStaging(): Promise<void> {
    if (stagingReady === null) {
      stagingReady = rm(stagingDir, { recursive: true, force: true }).then(
        async () => {
          await mkdir(stagingDir, { recursive: true });
        },
      );
    }
    return stagingReady;
  }

  seedOfficialMarketplace();

  const locks = new Map<string, Promise<unknown>>();
  const ADD_LOCK_KEY = "\0add";
  let cancelPeriodic: (() => void) | null = null;
  let periodicStopped = true;

  function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    locks.set(key, tail);
    return result.finally(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
  }

  function seedOfficialMarketplace(): void {
    const existing = getPluginMarketplace(deps.db, CURATED_MARKETPLACE_NAME);
    if (
      existing !== undefined &&
      existing.sourceKind === "https" &&
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
          `stored ${CURATED_MARKETPLACE_NAME} catalog was rejected; using the bundled snapshot: ${marketplaceErrorMessage(error)}`,
        );
      }
    }
    upsertPluginMarketplace(deps.db, {
      name: CURATED_MARKETPLACE_NAME,
      sourceKind: "https",
      manifestUrl: deps.marketplaceUrl,
      sourceGitRef: null,
      sourceGitCommit: null,
      manifestJson: JSON.stringify(BUNDLED_CURATED_MARKETPLACE),
      statsJson: existing?.statsJson ?? null,
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: null,
      lastAttemptedRefreshAt: existing?.lastAttemptedRefreshAt ?? null,
      lastError: null,
    });
  }

  function requireRow(name: string): PluginMarketplaceRow {
    const row = getPluginMarketplace(deps.db, name);
    if (row === undefined) throw new Error(`unknown marketplace "${name}"`);
    return row;
  }

  function catalogOf(row: PluginMarketplaceRow): MarketplaceManifest | null {
    try {
      return parseMarketplaceManifestJson(
        row.manifestJson,
        `stored "${row.name}" marketplace catalog`,
      );
    } catch (error) {
      deps.warn?.(marketplaceErrorMessage(error));
      return null;
    }
  }

  function orderedMarketplaces(): PluginMarketplaceRow[] {
    return listPluginMarketplaces(deps.db).sort((left, right) => {
      const officialDifference =
        Number(right.name === CURATED_MARKETPLACE_NAME) -
        Number(left.name === CURATED_MARKETPLACE_NAME);
      return officialDifference || left.name.localeCompare(right.name);
    });
  }

  function marketplaceView(row: PluginMarketplaceRow): PluginMarketplace {
    const catalog = catalogOf(row);
    return {
      name: row.name,
      displayName: catalog?.displayName ?? row.name,
      description: catalog?.description ?? null,
      official: row.name === CURATED_MARKETPLACE_NAME,
      sourceKind: row.sourceKind,
      source: marketplaceSourceDisplay(marketplaceSourceFromRow(row)),
      resolvedCommit: row.sourceGitCommit,
      entryCount: catalog?.plugins.length ?? 0,
      lastRefreshAt: row.lastSuccessfulRefreshAt,
      lastAttemptAt: row.lastAttemptedRefreshAt,
      lastError: row.lastError,
    };
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

  async function bundledIcon(
    manifest: PluginManifest,
  ): Promise<{ bytes: Buffer; hash: string } | null> {
    const path = manifest.branding.compactIconPath;
    if (path === undefined) return null;
    try {
      const bytes = await readFile(path);
      return {
        bytes,
        hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      };
    } catch (error: unknown) {
      deps.warn?.(
        `bundled plugin ${manifest.id} icon is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  function bundledSearchResult(
    entry: { name: string; pluginId: string; category: string },
    manifest: PluginManifest,
    iconHash: string | null,
    installs: number | null,
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
      iconUrl:
        iconHash === null
          ? null
          : entryIconAssetUrl(CURATED_MARKETPLACE_NAME, entry.name, iconHash),
      iconTinted: iconHash !== null,
      category: entry.category,
      source: builtinPluginSource(entry.name),
      repositoryUrl: null,
      marketplace: CURATED_MARKETPLACE_NAME,
      marketplaceDisplayName: BUNDLED_CURATED_MARKETPLACE.displayName,
      publisherKey: BUILTIN_PUBLISHER_KEY,
      publisherLabel: BUILTIN_PUBLISHER_LABEL,
      official: true,
      author: { name: "BB Team", url: "https://getbb.app" },
      installed: getInstalledPlugin(deps.db, entry.pluginId) !== undefined,
      installs,
      compatible: problem === null,
      incompatibleReason: problem,
    };
  }

  function entryCategory(entry: MarketplaceEntry, official: boolean): string {
    const tags = entry.tags ?? [];
    if (official) {
      for (const tag of tags) {
        const category = categoryByTag.get(tag);
        if (category !== undefined) return category;
      }
      return "Other";
    }
    const first = tags[0];
    return first === undefined ? "Other" : titleCaseTag(first);
  }

  function entryIconAssetUrl(
    marketplace: string,
    entryId: string,
    contentHash: string,
  ): string {
    return `/api/v1/plugin-catalog/icons/${encodeURIComponent(marketplace)}/${encodeURIComponent(entryId)}?h=${contentHash}`;
  }

  function entryIconAsset(
    marketplace: string,
    entryId: string,
  ): { iconUrl: string | null; iconTinted: boolean } {
    const icon = getPluginMarketplaceIcon(deps.db, marketplace, entryId);
    return icon === undefined
      ? { iconUrl: null, iconTinted: false }
      : {
          iconUrl: entryIconAssetUrl(marketplace, entryId, icon.contentHash),
          iconTinted: entryIconTinted(icon.contentType),
        };
  }

  function catalogSearchResult(args: {
    entry: MarketplaceEntry;
    row: PluginMarketplaceRow;
    catalog: MarketplaceManifest;
    installedEntryIds: ReadonlySet<string>;
    installs: number | null;
  }): PluginCatalogSearchResult {
    const { entry, row, catalog } = args;
    const official = row.name === CURATED_MARKETPLACE_NAME;
    return {
      entryId: entry.id,
      pluginId: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      icon: entryIconName(entry),
      ...entryIconAsset(row.name, entry.id),
      category: entryCategory(entry, official),
      source: entrySourceDisplay(entry),
      repositoryUrl: entryRepositoryUrl(entry),
      marketplace: row.name,
      marketplaceDisplayName: catalog.displayName,
      publisherKey: row.name,
      publisherLabel: marketplacePublisherLabel({
        marketplaceName: row.name,
        displayName: catalog.displayName,
      }),
      official,
      author: entryAuthor(entry),
      installed:
        args.installedEntryIds.has(catalogEntryKey(row.name, entry.id)) ||
        getInstalledPlugin(deps.db, entry.id) !== undefined,
      installs: args.installs,
      compatible: true,
      incompatibleReason: null,
    };
  }

  function rejectBundledIdCollisions(catalog: MarketplaceManifest): {
    catalog: MarketplaceManifest;
    error: string | null;
  } {
    const bundledIds = new Set(bundledPlugins.map((plugin) => plugin.pluginId));
    const colliding = catalog.plugins.filter((entry) =>
      bundledIds.has(entry.id),
    );
    if (colliding.length === 0) return { catalog, error: null };
    const ids = colliding.map((entry) => entry.id).join(", ");
    return {
      catalog: {
        ...catalog,
        plugins: catalog.plugins.filter((entry) => !bundledIds.has(entry.id)),
      },
      error: `dropped ${colliding.length} catalog ${colliding.length === 1 ? "entry" : "entries"} whose id matches a bundled plugin: ${ids}`,
    };
  }

  async function refreshedStatsJson(
    row: PluginMarketplaceRow,
  ): Promise<string | null> {
    if (row.name !== CURATED_MARKETPLACE_NAME || row.sourceKind !== "https") {
      return null;
    }
    try {
      const stats = await fetchMarketplaceStats({
        manifestUrl: row.manifestUrl,
        fetch: fetchMarketplace,
      });
      return stats === null ? null : JSON.stringify(stats);
    } catch (error) {
      deps.warn?.(
        `${row.name} install counts were not refreshed: ${marketplaceErrorMessage(error)}`,
      );
      return row.statsJson;
    }
  }

  async function performRefresh(
    row: PluginMarketplaceRow,
    attemptedAt: number,
  ): Promise<void> {
    let collisionError: string | null = null;
    const source = marketplaceSourceFromRow(row);
    if (source.kind === "git") await prepareMarketplaceStaging();
    const materialized = await materializeMarketplace({
      source,
      cached: {
        manifestJson: row.manifestJson,
        etag: row.etag,
        lastModified: row.lastModified,
      },
      stagingDir,
      fetch: fetchMarketplace,
    });
    try {
      if (materialized.catalog.name !== row.name) {
        throw new Error(
          `invalid marketplace manifest: expected name "${row.name}", got ${JSON.stringify(materialized.catalog.name)}`,
        );
      }
      const rejection = rejectBundledIdCollisions(materialized.catalog);
      const catalog = rejection.catalog;
      collisionError = rejection.error;
      if (collisionError !== null) {
        deps.warn?.(`marketplace ${row.name} refresh ${collisionError}`);
      }
      const manifestJson =
        collisionError === null
          ? materialized.manifestJson
          : JSON.stringify(catalog);
      const icons = await fetchMarketplaceIcons({
        db: deps.db,
        marketplaceName: row.name,
        base: materialized.iconBase,
        entries: catalog.plugins,
        onlyMissing: materialized.unchanged,
        fetch: fetchMarketplace,
        ...(deps.warn === undefined ? {} : { warn: deps.warn }),
      });
      const statsJson = await refreshedStatsJson(row);
      deps.db.transaction((tx) => {
        upsertPluginMarketplace(tx, {
          name: row.name,
          ...marketplaceSourceColumns(source),
          sourceGitCommit: materialized.commit,
          manifestJson,
          statsJson,
          etag: materialized.etag,
          lastModified: materialized.lastModified,
          lastSuccessfulRefreshAt: attemptedAt,
          lastAttemptedRefreshAt: attemptedAt,
          lastError: collisionError,
        });
        replacePluginMarketplaceIcons(tx, row.name, icons);
      });
      deps.notifyCatalogChanged?.();
    } finally {
      await materialized.dispose();
    }
  }

  async function refreshOne(
    name: string,
    attemptedAt: number,
  ): Promise<PluginMarketplaceRefreshResult> {
    return withLock(name, async () => {
      const row = requireRow(name);
      try {
        await performRefresh(row, attemptedAt);
        return {
          name,
          ok: true,
          error: null,
          marketplace: marketplaceView(requireRow(name)),
        };
      } catch (error) {
        const message = marketplaceErrorMessage(error);
        recordPluginMarketplaceRefreshFailure(
          deps.db,
          name,
          attemptedAt,
          message,
        );
        return {
          name,
          ok: false,
          error: message,
          marketplace: marketplaceView(requireRow(name)),
        };
      }
    });
  }

  async function refreshMarketplaces(args?: {
    name?: string;
    attemptedAt?: number;
  }): Promise<PluginMarketplaceRefreshResult[]> {
    const attemptedAt = args?.attemptedAt ?? now();
    if (args?.name !== undefined) {
      requireRow(args.name);
      return [await refreshOne(args.name, attemptedAt)];
    }
    const results: PluginMarketplaceRefreshResult[] = [];
    for (const row of orderedMarketplaces()) {
      results.push(await refreshOne(row.name, attemptedAt));
    }
    return results;
  }

  function scheduleNextPeriodicRefresh(): void {
    if (periodicStopped) return;
    cancelPeriodic?.();
    const lastAttempt = requireRow(
      CURATED_MARKETPLACE_NAME,
    ).lastAttemptedRefreshAt;
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
    void refreshMarketplaces()
      .then((results) => {
        for (const result of results) {
          if (result.ok) continue;
          deps.warn?.(
            `periodic ${result.name} catalog refresh failed: ${result.error ?? "unknown error"}`,
          );
        }
      })
      .catch((error: unknown) => {
        deps.warn?.(
          `periodic catalog refresh failed: ${marketplaceErrorMessage(error)}`,
        );
      })
      .finally(scheduleNextPeriodicRefresh);
  }

  function resolveEntry(
    selector: PluginCatalogEntrySelector,
  ): ResolvedCatalogEntry {
    const { entryId } = selector;
    if (selector.marketplace !== undefined) {
      const row = requireRow(selector.marketplace);
      const entry = catalogOf(row)?.plugins.find(
        (candidate) => candidate.id === entryId,
      );
      if (entry !== undefined) return { kind: "marketplace", row, entry };
      const bundled =
        selector.marketplace === CURATED_MARKETPLACE_NAME
          ? officialPlugins.find((candidate) => candidate.name === entryId)
          : undefined;
      if (bundled !== undefined) return { kind: "bundled", entry: bundled };
      throw new Error(
        `unknown marketplace entry "${entryId}@${selector.marketplace}"`,
      );
    }
    const matches: { row: PluginMarketplaceRow; entry: MarketplaceEntry }[] =
      [];
    for (const row of orderedMarketplaces()) {
      const entry = catalogOf(row)?.plugins.find(
        (candidate) => candidate.id === entryId,
      );
      if (entry !== undefined) matches.push({ row, entry });
    }
    if (matches.length > 1) {
      const choices = matches
        .map((match) => `${entryId}@${match.row.name}`)
        .join(", ");
      throw new Error(
        `"${entryId}" is listed by several marketplaces; install one of: ${choices}`,
      );
    }
    const only = matches[0];
    if (only !== undefined) {
      return { kind: "marketplace", row: only.row, entry: only.entry };
    }
    const bundled = officialPlugins.find(
      (candidate) => candidate.name === entryId,
    );
    if (bundled === undefined) {
      throw new Error(`unknown plugin catalog entry "${entryId}"`);
    }
    return { kind: "bundled", entry: bundled };
  }

  async function resolveGitEntrySource(
    git: Extract<MarketplaceEntry["source"], { git: unknown }>["git"],
  ): Promise<PluginCatalogResolvedSource> {
    const base = {
      kind: "git" as const,
      url: git.url,
      ...(git.subdir === undefined ? {} : { subdir: git.subdir }),
    };
    try {
      if ("ref" in git) {
        const resolved = await resolveGitRef({ url: git.url, ref: git.ref });
        return resolved.outcome === "resolved"
          ? { ...base, ref: git.ref, resolvedCommit: resolved.commit }
          : { ...base, ref: git.ref, unresolvedReason: resolved.detail };
      }
      const tagPrefix = git.tagPrefix ?? "";
      const tags = await listGitSemverTags({ url: git.url, tagPrefix });
      const selected = selectGitSemverTag({ tags, range: git.range });
      const ranged = {
        ...base,
        range: git.range,
        ...(git.tagPrefix === undefined ? {} : { tagPrefix: git.tagPrefix }),
      };
      return selected === null
        ? {
            ...ranged,
            unresolvedReason: `no release tag of ${git.url} matches ${git.range}`,
          }
        : {
            ...ranged,
            resolvedTag: selected.tag,
            resolvedCommit: selected.commit,
          };
    } catch (error) {
      return {
        ...base,
        ...("ref" in git
          ? { ref: git.ref }
          : {
              range: git.range,
              ...(git.tagPrefix === undefined
                ? {}
                : { tagPrefix: git.tagPrefix }),
            }),
        unresolvedReason: marketplaceErrorMessage(error),
      };
    }
  }

  async function resolveNpmEntrySource(
    npm: Extract<MarketplaceEntry["source"], { npm: unknown }>["npm"],
  ): Promise<PluginCatalogResolvedSource> {
    const base = {
      kind: "npm" as const,
      package: npm.package,
      ...(npm.range === undefined ? {} : { range: npm.range }),
      ...(npm.tag === undefined ? {} : { tag: npm.tag }),
      ...(npm.registry === undefined ? {} : { registry: npm.registry }),
    };
    try {
      const resolved = await deps.plugins.resolveCatalogNpmSource({
        packageName: npm.package,
        ...(npm.registry === undefined ? {} : { registry: npm.registry }),
        requestedSpec: npm.range ?? npm.tag ?? "",
        specKind:
          npm.range !== undefined
            ? "range"
            : npm.tag !== undefined
              ? "tag"
              : "default",
      });
      if (resolved.outcome === "unavailable") {
        return { ...base, unresolvedReason: resolved.detail };
      }
      return {
        ...base,
        resolvedVersion: resolved.version,
        ...(resolved.integrity.length === 0
          ? {}
          : { resolvedIntegrity: resolved.integrity }),
      };
    } catch (error) {
      return { ...base, unresolvedReason: marketplaceErrorMessage(error) };
    }
  }

  async function resolvedEntrySourceView(
    entry: MarketplaceEntry,
    official: boolean,
  ): Promise<PluginCatalogResolvedSource> {
    if ("npm" in entry.source) {
      const npm = entry.source.npm;
      if (official) {
        return {
          kind: "npm",
          package: npm.package,
          ...(npm.range === undefined ? {} : { range: npm.range }),
          ...(npm.tag === undefined ? {} : { tag: npm.tag }),
          ...(npm.registry === undefined ? {} : { registry: npm.registry }),
        };
      }
      return resolveNpmEntrySource(npm);
    }
    const git = entry.source.git;
    if (official) {
      return {
        kind: "git",
        url: git.url,
        ...(git.subdir === undefined ? {} : { subdir: git.subdir }),
        ...("ref" in git
          ? { ref: git.ref }
          : {
              range: git.range,
              ...(git.tagPrefix === undefined
                ? {}
                : { tagPrefix: git.tagPrefix }),
            }),
      };
    }
    return resolveGitEntrySource(git);
  }

  type ConfirmedEntryBinding =
    | { kind: "git"; commit: string }
    | { kind: "npm"; version: string; integrity: string | undefined };

  async function installMarketplaceEntry(
    row: PluginMarketplaceRow,
    entry: MarketplaceEntry,
    binding?: ConfirmedEntryBinding,
  ): Promise<InstalledPlugin> {
    const resolved = resolvedEntrySource(entry);
    return deps.plugins.installCatalogPlugin({
      marketplace: row.name,
      entryId: entry.id,
      pluginId: entry.id,
      source: resolved.source,
      selection: resolved.selection,
      ...(resolved.npmRegistry === undefined
        ? {}
        : { npmRegistry: resolved.npmRegistry }),
      ...(binding?.kind === "git" ? { expectedGitCommit: binding.commit } : {}),
      ...(binding?.kind === "npm"
        ? {
            expectedNpmVersion: binding.version,
            ...(binding.integrity === undefined
              ? {}
              : { expectedNpmIntegrity: binding.integrity }),
          }
        : {}),
    });
  }

  async function confirmedThirdPartySource(args: {
    entry: MarketplaceEntry;
    confirmed: PluginCatalogResolvedSource | undefined;
  }): Promise<ConfirmedEntryBinding> {
    if (args.confirmed === undefined) {
      throw new Error(
        "install refused: confirm the third-party marketplace source first",
      );
    }
    const current = await resolvedEntrySourceView(args.entry, false);
    if (!isDeepStrictEqual(current, args.confirmed)) {
      throw new Error(
        "install refused: the marketplace source changed after confirmation; review it again",
      );
    }
    if (current.kind === "npm") {
      if (current.resolvedVersion === undefined) {
        throw new Error(
          `install refused: the npm source could not be resolved (${current.unresolvedReason ?? "no version"})`,
        );
      }
      return {
        kind: "npm",
        version: current.resolvedVersion,
        integrity: current.resolvedIntegrity,
      };
    }
    if (current.resolvedCommit === undefined) {
      throw new Error(
        `install refused: the git source could not be resolved (${current.unresolvedReason ?? "no commit"})`,
      );
    }
    return { kind: "git", commit: current.resolvedCommit };
  }

  return {
    status() {
      const marketplaceEntryCount = orderedMarketplaces().reduce(
        (total, row) => total + (catalogOf(row)?.plugins.length ?? 0),
        0,
      );
      return {
        pluginCount: bundledPlugins.length + marketplaceEntryCount,
        includedPluginCount: bundledPlugins.filter(
          (plugin) => plugin.autoInstall,
        ).length,
        optionalPluginCount:
          bundledPlugins.filter((plugin) => !plugin.autoInstall).length +
          marketplaceEntryCount,
      };
    },

    async refresh(attemptedAt = now()) {
      const [result] = await refreshMarketplaces({
        name: CURATED_MARKETPLACE_NAME,
        attemptedAt,
      });
      scheduleNextPeriodicRefresh();
      if (result !== undefined && !result.ok) {
        throw new Error(result.error ?? "marketplace refresh failed");
      }
    },

    refreshMarketplaces,

    async icon(marketplace, entryId) {
      const row = getPluginMarketplaceIcon(deps.db, marketplace, entryId);
      if (row !== undefined) {
        return {
          bytes: row.bytes,
          contentType: row.contentType,
          hash: row.contentHash,
        };
      }
      if (marketplace !== CURATED_MARKETPLACE_NAME) return undefined;
      const bundled = officialPlugins.find((entry) => entry.name === entryId);
      if (bundled === undefined) return undefined;
      const manifest = await entryManifest(bundled);
      const icon = manifest === null ? null : await bundledIcon(manifest);
      return icon === null
        ? undefined
        : {
            bytes: icon.bytes,
            contentType: BUNDLED_ICON_CONTENT_TYPE,
            hash: icon.hash,
          };
    },

    listMarketplaces() {
      return orderedMarketplaces().map(marketplaceView);
    },

    async addMarketplace(rawSource) {
      return withLock(ADD_LOCK_KEY, async () => {
        const source = parseMarketplaceSource(rawSource);
        if (source.kind === "git") await prepareMarketplaceStaging();
        const materialized = await materializeMarketplace({
          source,
          cached: null,
          stagingDir,
          fetch: fetchMarketplace,
        });
        try {
          const name = materialized.catalog.name;
          if (name === CURATED_MARKETPLACE_NAME) {
            throw new Error(
              `marketplace name "${CURATED_MARKETPLACE_NAME}" is reserved for the marketplace BB curates`,
            );
          }
          if (getPluginMarketplace(deps.db, name) !== undefined) {
            throw new Error(`marketplace "${name}" is already added`);
          }
          const icons = await fetchMarketplaceIcons({
            db: deps.db,
            marketplaceName: name,
            base: materialized.iconBase,
            entries: materialized.catalog.plugins,
            onlyMissing: false,
            fetch: fetchMarketplace,
            ...(deps.warn === undefined ? {} : { warn: deps.warn }),
          });
          const addedAt = now();
          deps.db.transaction((tx) => {
            upsertPluginMarketplace(tx, {
              name,
              ...marketplaceSourceColumns(source),
              sourceGitCommit: materialized.commit,
              manifestJson: materialized.manifestJson,
              statsJson: null,
              etag: materialized.etag,
              lastModified: materialized.lastModified,
              lastSuccessfulRefreshAt: addedAt,
              lastAttemptedRefreshAt: addedAt,
              lastError: null,
            });
            replacePluginMarketplaceIcons(tx, name, icons);
          });
          deps.notifyCatalogChanged?.();
          return marketplaceView(requireRow(name));
        } finally {
          await materialized.dispose();
        }
      });
    },

    async removeMarketplace(name) {
      return withLock(name, async () => {
        if (name === CURATED_MARKETPLACE_NAME) {
          throw new Error(
            `marketplace "${CURATED_MARKETPLACE_NAME}" cannot be removed`,
          );
        }
        requireRow(name);
        const convertedPluginIds = deps.db.transaction((tx) => {
          const converted: string[] = [];
          for (const plugin of listInstalledPluginsFromMarketplace(tx, name)) {
            if (!setInstalledPluginDirectProvenance(tx, plugin.id)) {
              throw new Error(
                `plugin "${plugin.id}" disappeared during marketplace removal`,
              );
            }
            converted.push(plugin.id);
          }
          deletePluginMarketplace(tx, name);
          return converted;
        });
        deps.notifyCatalogChanged?.();
        return { convertedPluginIds };
      });
    },

    async search(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      const curatedRow = getPluginMarketplace(
        deps.db,
        CURATED_MARKETPLACE_NAME,
      );
      const curatedInstalls = installCountsFromStatsJson(
        curatedRow?.statsJson ?? null,
        (message) => deps.warn?.(message),
      );
      const bundledEntries = await Promise.all(
        officialPlugins.map(async (entry) => {
          const manifest = await entryManifest(entry);
          if (manifest === null) return null;
          const icon = await bundledIcon(manifest);
          return {
            pluginId: entry.pluginId,
            tags: [] as string[],
            marketplaceRank: 0,
            result: bundledSearchResult(
              entry,
              manifest,
              icon?.hash ?? null,
              curatedInstalls.get(entry.pluginId) ?? null,
            ),
          };
        }),
      );
      const installedEntryIds = new Set(
        listInstalledPlugins(deps.db)
          .filter(
            (
              row,
            ): row is typeof row & {
              catalogEntryId: string;
              catalogMarketplaceName: string;
            } =>
              row.catalogMarketplaceName !== null &&
              row.catalogEntryId !== null,
          )
          .map((row) =>
            catalogEntryKey(row.catalogMarketplaceName, row.catalogEntryId),
          ),
      );
      const catalogEntries = orderedMarketplaces().flatMap((row, index) => {
        const catalog = catalogOf(row);
        if (catalog === null) return [];
        const official = row.name === CURATED_MARKETPLACE_NAME;
        return catalog.plugins.map((entry) => ({
          pluginId: entry.id,
          tags: entry.tags ?? [],
          marketplaceRank: index,
          result: catalogSearchResult({
            entry,
            row,
            catalog,
            installedEntryIds,
            installs: official ? (curatedInstalls.get(entry.id) ?? null) : null,
          }),
        }));
      });
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
              entry.result.marketplaceDisplayName,
              ...entry.tags,
            ]
              .join("\n")
              .toLowerCase()
              .includes(query),
        )
        .sort((left, right) => {
          const marketplaceDifference =
            left.marketplaceRank - right.marketplaceRank;
          if (marketplaceDifference !== 0) return marketplaceDifference;
          const categoryDifference =
            (categoryOrder.get(left.result.category) ?? categoryOrder.size) -
            (categoryOrder.get(right.result.category) ?? categoryOrder.size);
          return (
            categoryDifference ||
            left.result.category.localeCompare(right.result.category) ||
            left.result.displayName.localeCompare(right.result.displayName)
          );
        })
        .map(({ result }) => result);
    },

    async installPlan(selector) {
      const resolved = resolveEntry(selector);
      if (resolved.kind === "bundled") {
        const manifest = await entryManifest(resolved.entry);
        if (manifest === null) {
          throw new Error(
            `official plugin "${resolved.entry.name}" is unavailable in this build`,
          );
        }
        const problem = compatibilityProblem({
          bbRange: manifest.bbEngineRange,
          sdkRange: manifest.bbPluginSdkRange,
        });
        return {
          kind: "bundled",
          entryId: resolved.entry.name,
          pluginId: resolved.entry.pluginId,
          displayName: manifest.name,
          source: builtinPluginSource(resolved.entry.name),
          compatible: problem === null,
          incompatibleReason: problem,
        };
      }
      const { row, entry } = resolved;
      const official = row.name === CURATED_MARKETPLACE_NAME;
      return {
        kind: "marketplace",
        entryId: entry.id,
        pluginId: entry.id,
        displayName: entry.displayName,
        marketplace: row.name,
        marketplaceDisplayName: catalogOf(row)?.displayName ?? row.name,
        official,
        author: entryAuthor(entry),
        source: resolvedEntrySource(entry).source,
        resolvedSource: await resolvedEntrySourceView(entry, official),
        compatible: true,
        incompatibleReason: null,
      };
    },

    async install(input) {
      const resolved = resolveEntry(input);
      if (resolved.kind === "marketplace") {
        return withLock(resolved.row.name, async () => {
          const current = resolveEntry({
            ...input,
            marketplace: resolved.row.name,
          });
          if (current.kind !== "marketplace") {
            throw new Error(
              `install refused: "${input.entryId}" is no longer listed by marketplace "${resolved.row.name}"`,
            );
          }
          const thirdParty = current.row.name !== CURATED_MARKETPLACE_NAME;
          if (!thirdParty && input.confirmedSource !== undefined) {
            throw new Error(
              "install refused: confirmedSource applies only to third-party marketplaces",
            );
          }
          const binding = thirdParty
            ? await confirmedThirdPartySource({
                entry: current.entry,
                confirmed: input.confirmedSource,
              })
            : undefined;
          return installMarketplaceEntry(current.row, current.entry, binding);
        });
      }
      if (input.confirmedSource !== undefined) {
        throw new Error(
          "install refused: confirmedSource applies only to third-party marketplaces",
        );
      }
      const manifest = await entryManifest(resolved.entry);
      if (manifest === null) {
        throw new Error(
          `official plugin "${resolved.entry.name}" is unavailable in this build`,
        );
      }
      const problem = compatibilityProblem({
        bbRange: manifest.bbEngineRange,
        sdkRange: manifest.bbPluginSdkRange,
      });
      if (problem !== null) throw new Error(`install refused: ${problem}`);
      return deps.plugins.installOfficialPlugin(resolved.entry.name);
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

function catalogEntryKey(marketplace: string, entryId: string): string {
  return `${marketplace}\u0000${entryId}`;
}

function entryAuthor(entry: MarketplaceEntry): PluginCatalogAuthor {
  const url =
    entry.author.url ??
    (entry.author.github === undefined
      ? null
      : `https://github.com/${entry.author.github}`);
  return { name: entry.author.name, url };
}

function titleCaseTag(tag: string): string {
  return tag
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
