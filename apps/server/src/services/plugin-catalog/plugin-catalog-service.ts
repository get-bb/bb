import { getInstalledPlugin, type DbConnection } from "@bb/db";
import type {
  InstalledPlugin,
  PluginCatalogSearchResult,
  PluginCatalogStatus,
} from "@bb/server-contract";
import {
  builtinPluginSource,
  GIT_OFFICIAL_PLUGINS,
  listBundledPluginRegistrations,
  PLUGIN_CATALOG_CATEGORIES,
  type BundledPluginRegistration,
  type GitOfficialPluginDefinition,
} from "../plugins/builtin-registry.js";
import {
  readPluginManifest,
  type PluginManifest,
} from "../plugins/manifest.js";
import type { PluginService } from "../plugins/plugin-service.js";
import { evaluateCompatibility } from "../plugins/update-resolver.js";

export interface PluginCatalogService {
  status(): PluginCatalogStatus;
  search(query: string): Promise<PluginCatalogSearchResult[]>;
  install(entryId: string): Promise<InstalledPlugin>;
}

/**
 * The plugin store over the official plugins bundled with the app plus the
 * git-sourced official entries. Bundled entries install from the local
 * bundled copy — no network, no remote catalog; installed plugins update by
 * riding app releases. Git entries install from their pinned repository ref
 * with catalog provenance, so they list as official and update through the
 * regular git update flow.
 */
export function createPluginCatalogService(deps: {
  db: DbConnection;
  appVersion: string;
  plugins: Pick<
    PluginService,
    "installOfficialPlugin" | "installGitCatalogPlugin"
  >;
  bundledPlugins?: readonly BundledPluginRegistration[];
  gitOfficialPlugins?: readonly GitOfficialPluginDefinition[];
  warn?: (message: string) => void;
}): PluginCatalogService {
  const bundledPlugins =
    deps.bundledPlugins ?? listBundledPluginRegistrations();
  const gitOfficialPlugins = deps.gitOfficialPlugins ?? GIT_OFFICIAL_PLUGINS;
  const officialPlugins = bundledPlugins.map((plugin) => ({
    ...plugin,
    category: plugin.category ?? "Other",
  }));
  const categoryOrder = new Map<string, number>(
    PLUGIN_CATALOG_CATEGORIES.map((category, index) => [category, index]),
  );

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

  function searchResult(
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
      category: entry.category,
      source: builtinPluginSource(entry.name),
      installed: getInstalledPlugin(deps.db, entry.pluginId) !== undefined,
      compatible: problem === null,
      incompatibleReason: problem,
    };
  }

  function gitCompatibilityProblem(
    entry: GitOfficialPluginDefinition,
  ): string | null {
    return compatibilityProblem({
      bbRange: entry.bbEngineRange,
      sdkRange: entry.bbPluginSdkRange,
    });
  }

  function gitSearchResult(
    entry: GitOfficialPluginDefinition,
  ): PluginCatalogSearchResult {
    const problem = gitCompatibilityProblem(entry);
    return {
      entryId: entry.name,
      pluginId: entry.pluginId,
      displayName: entry.displayName,
      description: entry.description,
      icon: entry.icon,
      category: entry.category,
      source: entry.gitSource,
      installed: getInstalledPlugin(deps.db, entry.pluginId) !== undefined,
      compatible: problem === null,
      incompatibleReason: problem,
    };
  }

  return {
    status: () => ({
      pluginCount: bundledPlugins.length + gitOfficialPlugins.length,
      includedPluginCount: bundledPlugins.filter((plugin) => plugin.autoInstall)
        .length,
      optionalPluginCount:
        bundledPlugins.filter((plugin) => !plugin.autoInstall).length +
        gitOfficialPlugins.length,
    }),

    async search(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      const entries = await Promise.all(
        officialPlugins.map(async (entry) => {
          const manifest = await entryManifest(entry);
          return manifest === null
            ? null
            : {
                pluginId: entry.pluginId,
                result: searchResult(entry, manifest),
              };
        }),
      );
      const gitEntries = gitOfficialPlugins.map((entry) => ({
        pluginId: entry.pluginId,
        result: gitSearchResult(entry),
      }));
      return [...entries, ...gitEntries]
        .filter((entry) => entry !== null)
        .filter(
          ({ pluginId, result }) =>
            query.length === 0 ||
            [
              result.entryId,
              pluginId,
              result.displayName,
              result.description,
              result.category,
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
      const gitEntry = gitOfficialPlugins.find(
        (candidate) => candidate.name === entryId,
      );
      if (gitEntry !== undefined) {
        // The UI disables incompatible entries, but the server owns the
        // policy: refuse direct installs the store would not offer.
        const problem = gitCompatibilityProblem(gitEntry);
        if (problem !== null) {
          throw new Error(`install refused: ${problem}`);
        }
        return deps.plugins.installGitCatalogPlugin({
          entryId: gitEntry.name,
          pluginId: gitEntry.pluginId,
          source: gitEntry.gitSource,
        });
      }
      const entry = officialPlugins.find(
        (candidate) => candidate.name === entryId,
      );
      if (entry === undefined) {
        throw new Error(`unknown plugin catalog entry "${entryId}"`);
      }
      // The UI disables incompatible entries, but the server owns the
      // policy: refuse direct installs the store would not offer.
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
  };
}
