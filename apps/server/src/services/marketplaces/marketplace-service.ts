import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  deleteMarketplace,
  getInstalledPlugin,
  getMarketplace,
  listInstalledPluginsFromMarketplace,
  listMarketplaces,
  setInstalledPluginDirectProvenance,
  updateMarketplaceRefreshFailure,
  upsertMarketplace,
  type DbConnection,
  type MarketplaceRow,
  type PluginUpdatePolicy,
} from "@bb/db";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import semver from "semver";
import type {
  PluginInstallPreview,
  PluginService,
} from "../plugins/plugin-service.js";
import {
  realPathInside,
  runInstallCommand,
} from "../plugins/install-sources.js";
import {
  catalogEntrySourceDisplay,
  parseMarketplaceCatalog,
  resolvedCatalogEntrySource,
  type MarketplaceCatalog,
  type MarketplaceCatalogEntry,
  validateMarketplaceCatalogRealPaths,
} from "./catalog.js";

interface MarketplaceSource {
  kind: "path" | "git";
  location: string;
  requestedRef: string | null;
  display: string;
}

export interface MarketplaceView {
  id: string;
  name: string;
  displayName: string;
  source: string;
  resolvedCommit?: string;
  pluginCount: number;
  lastRefreshAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  enabled: boolean;
}

export interface MarketplaceSearchResult {
  marketplaceId: string;
  entryId: string;
  displayName: string;
  description: string;
  category?: string;
  source: string;
  installed: boolean;
  compatible: boolean;
  incompatibleReason?: string;
}

export class MarketplaceDispositionError extends Error {
  constructor(
    message: string,
    readonly affectedPlugins: Array<{ id: string; version: string }>,
  ) {
    super(message);
  }
}

export interface MarketplaceService {
  add(source: string, name?: string): Promise<MarketplaceView>;
  list(): MarketplaceView[];
  refresh(id: string): Promise<MarketplaceView>;
  search(query: string): MarketplaceSearchResult[];
  install(
    marketplaceId: string,
    entryId: string,
    version?: string,
  ): Promise<unknown>;
  preview(
    marketplaceId: string,
    entryId: string,
    version?: string,
  ): Promise<PluginInstallPreview>;
  remove(
    id: string,
    dispositions: Array<{ pluginId: string; action: "keep" | "uninstall" }>,
  ): Promise<{ kept: string[]; uninstalled: string[] }>;
}

function catalogFromRow(row: MarketplaceRow): MarketplaceCatalog | null {
  if (row.catalogJson === null || row.cachePath === null) return null;
  const json: unknown = JSON.parse(row.catalogJson);
  return parseMarketplaceCatalog(
    json,
    row.sourceKind === "path" ? "path" : "git",
    row.cachePath,
  );
}

function sourceDisplay(row: MarketplaceRow): string {
  if (row.sourceKind === "path") return row.location;
  return `${row.location}${row.requestedGitRef === null ? "" : `@${row.requestedGitRef}`}`;
}

function view(row: MarketplaceRow): MarketplaceView {
  const catalog = catalogFromRow(row);
  return {
    id: row.id,
    name: row.id,
    displayName: row.displayName,
    source: sourceDisplay(row),
    ...(row.resolvedGitCommit === null
      ? {}
      : { resolvedCommit: row.resolvedGitCommit }),
    pluginCount: catalog?.plugins.length ?? 0,
    ...(row.lastSuccessfulRefreshAt === null
      ? {}
      : { lastRefreshAt: row.lastSuccessfulRefreshAt }),
    ...(row.lastAttemptedRefreshAt === null
      ? {}
      : { lastAttemptAt: row.lastAttemptedRefreshAt }),
    ...(row.lastError === null ? {} : { lastError: row.lastError }),
    enabled: row.enabled,
  };
}

async function parseSource(source: string): Promise<MarketplaceSource> {
  const display = source;
  const pathCandidate = resolve(
    source.startsWith("path:") ? source.slice(5) : source,
  );
  const pathExists = await stat(pathCandidate)
    .then((value) => value.isDirectory())
    .catch(() => false);
  if (
    source.startsWith("path:") ||
    source.startsWith(".") ||
    source.startsWith("/") ||
    pathExists
  ) {
    if (!pathExists)
      throw new Error(`marketplace path is not a directory: ${pathCandidate}`);
    return {
      kind: "path",
      location: pathCandidate,
      requestedRef: null,
      display,
    };
  }
  const shorthand = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:@([^@/]+))?$/u.exec(
    source,
  );
  if (shorthand !== null) {
    return {
      kind: "git",
      location: `https://github.com/${shorthand[1]}.git`,
      requestedRef: shorthand[2] ?? "HEAD",
      display,
    };
  }
  if (
    /^(?:file|https?|ssh|git):\/\//u.test(source) ||
    source.startsWith("git@")
  ) {
    const at = source.lastIndexOf("@");
    const schemeEnd = source.indexOf("://") + 3;
    const hasRef =
      (source.startsWith("git@") ? at > 3 : at > schemeEnd) &&
      !source.slice(at + 1).includes("/");
    return {
      kind: "git",
      location: hasRef ? source.slice(0, at) : source,
      requestedRef: hasRef ? source.slice(at + 1) : "HEAD",
      display,
    };
  }
  throw new Error(
    `invalid marketplace source "${source}"; expected owner/repo[@ref], a git URL[@ref], or a local path`,
  );
}

function effectivePolicy(
  marketplace: PluginUpdatePolicy,
  entry: PluginUpdatePolicy | undefined,
): PluginUpdatePolicy {
  const rank: Record<PluginUpdatePolicy, number> = {
    manual: 0,
    patch: 1,
    minor: 2,
    compatible: 3,
  };
  if (entry === undefined) return marketplace;
  return rank[entry] < rank[marketplace] ? entry : marketplace;
}

function compatibility(
  entry: MarketplaceCatalogEntry,
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

export function createMarketplaceService(deps: {
  db: DbConnection;
  dataDir: string;
  appVersion: string;
  plugins: PluginService;
  beforeMaterialize?: (args: {
    idHint: string;
    sourceKind: "path" | "git";
  }) => Promise<void>;
}): MarketplaceService {
  const marketplaceChains = new Map<string, Promise<void>>();
  const addLockKey = "\0marketplace-add";
  const cacheRoot = resolve(deps.dataDir, "marketplaces", "cache");

  async function withMarketplaceLock<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = marketplaceChains.get(id) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    marketplaceChains.set(id, tail);
    try {
      return await result;
    } finally {
      if (marketplaceChains.get(id) === tail) marketplaceChains.delete(id);
    }
  }

  function assertMarketplaceId(id: string): void {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
      throw new Error(`invalid marketplace name "${id}"`);
    }
  }

  function marketplaceCacheTarget(id: string, commit: string): string {
    assertMarketplaceId(id);
    if (!/^[0-9a-f]{40,64}$/u.test(commit)) {
      throw new Error(`invalid marketplace git commit "${commit}"`);
    }
    const target = resolve(cacheRoot, id, commit);
    const fromRoot = relative(cacheRoot, target);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new Error("invalid marketplace cache path");
    }
    return target;
  }

  async function materialize(
    source: MarketplaceSource,
    idHint: string,
  ): Promise<{
    root: string;
    commit: string | null;
    catalog: MarketplaceCatalog;
    hash: string;
  }> {
    await deps.beforeMaterialize?.({ idHint, sourceKind: source.kind });
    if (source.kind === "path") {
      const catalogPath = await realPathInside(
        source.location,
        join(source.location, "marketplace.json"),
        "marketplace catalog",
      );
      const raw = await readFile(catalogPath, "utf8");
      const json: unknown = JSON.parse(raw);
      const catalog = parseMarketplaceCatalog(json, "path", source.location);
      await validateMarketplaceCatalogRealPaths(
        catalog,
        "path",
        source.location,
      );
      return {
        root: source.location,
        commit: null,
        catalog,
        hash: createHash("sha256").update(raw).digest("hex"),
      };
    }
    const staging = join(deps.dataDir, "marketplaces", "staging", randomUUID());
    await mkdir(dirname(staging), { recursive: true });
    try {
      await runInstallCommand("git", [
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--quiet",
        "--no-checkout",
        source.location,
        staging,
      ]);
      if (source.requestedRef !== "HEAD") {
        await runInstallCommand("git", [
          "-c",
          "core.hooksPath=/dev/null",
          "-C",
          staging,
          "checkout",
          "--quiet",
          "--detach",
          source.requestedRef ?? "HEAD",
        ]);
      } else {
        await runInstallCommand("git", [
          "-c",
          "core.hooksPath=/dev/null",
          "-C",
          staging,
          "checkout",
          "--quiet",
          "--detach",
          "HEAD",
        ]);
      }
      const commit = await runInstallCommand("git", [
        "-C",
        staging,
        "rev-parse",
        "HEAD",
      ]);
      const catalogPath = await realPathInside(
        staging,
        join(staging, "marketplace.json"),
        "marketplace catalog",
      );
      const raw = await readFile(catalogPath, "utf8");
      const json: unknown = JSON.parse(raw);
      const catalog = parseMarketplaceCatalog(json, "git", staging);
      const hash = createHash("sha256").update(raw).digest("hex");
      await rm(join(staging, ".git"), { recursive: true, force: true });
      const target = marketplaceCacheTarget(idHint, commit);
      await mkdir(dirname(target), { recursive: true });
      const exists = await stat(target)
        .then(() => true)
        .catch(() => false);
      if (exists) await rm(staging, { recursive: true, force: true });
      else await rename(staging, target);
      return { root: target, commit, catalog, hash };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  return {
    async add(rawSource, requestedName) {
      return withMarketplaceLock(addLockKey, async () => {
        if (requestedName !== undefined) {
          assertMarketplaceId(requestedName);
          if (getMarketplace(deps.db, requestedName) !== undefined) {
            throw new Error(`marketplace "${requestedName}" already exists`);
          }
        }
        const source = await parseSource(rawSource);
        const materialized = await materialize(
          source,
          requestedName ?? "pending",
        );
        const id = requestedName ?? materialized.catalog.name;
        assertMarketplaceId(id);
        if (getMarketplace(deps.db, id) !== undefined) {
          throw new Error(`marketplace "${id}" already exists`);
        }
        let root = materialized.root;
        if (source.kind === "git" && requestedName === undefined) {
          if (materialized.commit === null) {
            throw new Error("git marketplace materialization has no commit");
          }
          const target = marketplaceCacheTarget(id, materialized.commit);
          await mkdir(dirname(target), { recursive: true });
          const exists = await stat(target)
            .then(() => true)
            .catch(() => false);
          if (!exists) await rename(root, target);
          else if (root !== target) {
            await rm(root, { recursive: true, force: true });
          }
          root = target;
        }
        const now = Date.now();
        return view(
          upsertMarketplace(deps.db, {
            id,
            displayName: materialized.catalog.displayName,
            sourceKind: source.kind,
            location: source.location,
            requestedGitRef: source.requestedRef,
            resolvedGitCommit: materialized.commit,
            cachePath: root,
            contentHash: materialized.hash,
            catalogJson: JSON.stringify(materialized.catalog),
            enabled: true,
            trusted: false,
            updatePolicy: "compatible",
            lastSuccessfulRefreshAt: now,
            lastAttemptedRefreshAt: now,
            lastError: null,
            scope: "user",
          }),
        );
      });
    },

    list() {
      return listMarketplaces(deps.db).map(view);
    },

    async refresh(id) {
      return withMarketplaceLock(id, async () => {
        const row = getMarketplace(deps.db, id);
        if (row === undefined) throw new Error(`unknown marketplace "${id}"`);
        const attemptedAt = Date.now();
        try {
          const source: MarketplaceSource = {
            kind: row.sourceKind === "path" ? "path" : "git",
            location: row.location,
            requestedRef: row.requestedGitRef,
            display: sourceDisplay(row),
          };
          const materialized = await materialize(source, row.id);
          return view(
            upsertMarketplace(deps.db, {
              id: row.id,
              displayName: materialized.catalog.displayName,
              sourceKind: row.sourceKind,
              location: row.location,
              requestedGitRef: row.requestedGitRef,
              resolvedGitCommit: materialized.commit,
              cachePath: materialized.root,
              contentHash: materialized.hash,
              catalogJson: JSON.stringify(materialized.catalog),
              enabled: row.enabled,
              trusted: row.trusted,
              updatePolicy: row.updatePolicy,
              lastSuccessfulRefreshAt: attemptedAt,
              lastAttemptedRefreshAt: attemptedAt,
              lastError: null,
              scope: row.scope,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          updateMarketplaceRefreshFailure(deps.db, id, attemptedAt, message);
          throw new Error(message);
        }
      });
    },

    search(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      const results: MarketplaceSearchResult[] = [];
      for (const row of listMarketplaces(deps.db)) {
        if (!row.enabled) continue;
        const catalog = catalogFromRow(row);
        if (catalog === null) continue;
        const installedEntries = new Set(
          listInstalledPluginsFromMarketplace(deps.db, row.id)
            .map((plugin) => plugin.marketplaceEntryId)
            .filter((entry): entry is string => entry !== null),
        );
        for (const entry of catalog.plugins) {
          const haystack = [
            entry.id,
            entry.displayName,
            entry.description,
            entry.category ?? "",
          ]
            .join("\n")
            .toLowerCase();
          if (query.length > 0 && !haystack.includes(query)) continue;
          const problem = compatibility(entry, deps.appVersion);
          results.push({
            marketplaceId: row.id,
            entryId: entry.id,
            displayName: entry.displayName,
            description: entry.description,
            ...(entry.category === undefined
              ? {}
              : { category: entry.category }),
            source: catalogEntrySourceDisplay(entry),
            installed:
              installedEntries.has(entry.id) ||
              getInstalledPlugin(deps.db, entry.id) !== undefined,
            compatible: problem === null,
            ...(problem === null ? {} : { incompatibleReason: problem }),
          });
        }
      }
      return results.sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.marketplaceId.localeCompare(right.marketplaceId),
      );
    },

    async install(marketplaceId, entryId, version) {
      return withMarketplaceLock(marketplaceId, async () => {
        const row = getMarketplace(deps.db, marketplaceId);
        if (row === undefined || !row.enabled)
          throw new Error(`unknown or disabled marketplace "${marketplaceId}"`);
        const catalog = catalogFromRow(row);
        const entry = catalog?.plugins.find(
          (candidate) => candidate.id === entryId,
        );
        if (entry === undefined || row.cachePath === null)
          throw new Error(
            `unknown marketplace entry "${entryId}" in "${marketplaceId}"`,
          );
        if (version !== undefined && !("npm" in entry.source)) {
          throw new Error(
            "version is only supported for npm marketplace entries",
          );
        }
        const resolved = resolvedCatalogEntrySource(entry, row.cachePath);
        if ("path" in entry.source) {
          resolved.source = `path:${await realPathInside(
            row.cachePath,
            resolve(row.cachePath, entry.source.path),
            `marketplace entry "${entry.id}" path`,
          )}`;
        }
        let source = resolved.source;
        if (version !== undefined && "npm" in entry.source)
          source = `npm:${entry.source.npm.package}@${version}`;
        return deps.plugins.installFromMarketplace({
          source,
          marketplaceId,
          entryId,
          updatePolicy: effectivePolicy(row.updatePolicy, entry.updatePolicy),
          installation: entry.installation,
          ...("npm" in entry.source && entry.source.npm.registry !== undefined
            ? { npmRegistry: entry.source.npm.registry }
            : {}),
          ...(resolved.gitSubdirectory === undefined
            ? {}
            : { gitSubdirectory: resolved.gitSubdirectory }),
        });
      });
    },

    async preview(marketplaceId, entryId, version) {
      const row = getMarketplace(deps.db, marketplaceId);
      if (row === undefined || !row.enabled)
        throw new Error(`unknown or disabled marketplace "${marketplaceId}"`);
      const catalog = catalogFromRow(row);
      const entry = catalog?.plugins.find(
        (candidate) => candidate.id === entryId,
      );
      if (entry === undefined || row.cachePath === null) {
        throw new Error(
          `unknown marketplace entry "${entryId}" in "${marketplaceId}"`,
        );
      }
      if (version !== undefined && !("npm" in entry.source)) {
        throw new Error(
          "version is only supported for npm marketplace entries",
        );
      }
      const resolved = resolvedCatalogEntrySource(entry, row.cachePath);
      if ("path" in entry.source) {
        resolved.source = `path:${await realPathInside(
          row.cachePath,
          resolve(row.cachePath, entry.source.path),
          `marketplace entry "${entry.id}" path`,
        )}`;
      }
      let source = resolved.source;
      if (version !== undefined && "npm" in entry.source) {
        source = `npm:${entry.source.npm.package}@${version}`;
      }
      return deps.plugins.previewInstallFromMarketplace({
        source,
        updatePolicy: effectivePolicy(row.updatePolicy, entry.updatePolicy),
        plugin: {
          id: entry.id,
          displayName: entry.displayName,
          description: entry.description,
        },
        ...(entry.installation === undefined
          ? {}
          : { installation: entry.installation }),
        ...("npm" in entry.source && entry.source.npm.registry !== undefined
          ? { npmRegistry: entry.source.npm.registry }
          : {}),
        ...(resolved.gitSubdirectory === undefined
          ? {}
          : { gitSubdirectory: resolved.gitSubdirectory }),
      });
    },

    async remove(id, dispositions) {
      return withMarketplaceLock(id, async () => {
        const row = getMarketplace(deps.db, id);
        if (row === undefined) throw new Error(`unknown marketplace "${id}"`);
        const affected = listInstalledPluginsFromMarketplace(deps.db, id);
        const dispositionById = new Map(
          dispositions.map((item) => [item.pluginId, item.action]),
        );
        const missing = affected.filter(
          (plugin) => !dispositionById.has(plugin.id),
        );
        const unknown = dispositions.filter(
          (item) => !affected.some((plugin) => plugin.id === item.pluginId),
        );
        if (
          missing.length > 0 ||
          unknown.length > 0 ||
          dispositionById.size !== dispositions.length
        ) {
          throw new MarketplaceDispositionError(
            missing.length > 0
              ? "explicit dispositions are required for every installed plugin from this marketplace"
              : "dispositions must name each affected plugin exactly once",
            affected.map(({ id: pluginId, version }) => ({
              id: pluginId,
              version,
            })),
          );
        }
        const kept: string[] = [];
        const uninstalled: string[] = [];
        for (const plugin of affected) {
          if (dispositionById.get(plugin.id) === "keep") {
            if (!setInstalledPluginDirectProvenance(deps.db, plugin.id))
              throw new Error(
                `plugin "${plugin.id}" disappeared during marketplace removal`,
              );
            kept.push(plugin.id);
          } else {
            if (!(await deps.plugins.remove(plugin.id)))
              throw new Error(
                `plugin "${plugin.id}" disappeared during marketplace removal`,
              );
            uninstalled.push(plugin.id);
          }
        }
        deleteMarketplace(deps.db, id);
        return { kept, uninstalled };
      });
    },
  };
}
