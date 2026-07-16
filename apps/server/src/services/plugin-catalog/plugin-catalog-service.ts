import { getInstalledPlugin, type DbConnection } from "@bb/db";
import type {
  InstalledPlugin,
  PluginCatalogSearchResult,
  PluginCatalogStatus,
} from "@bb/server-contract";
import {
  builtinPluginSource,
  listBundledPluginRegistrations,
  type BundledPluginRegistration,
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
 * The plugin store over the official plugins bundled with the app. Entries
 * install from the local bundled copy — no network, no remote catalog;
 * installed plugins update by riding app releases.
 */
export function createPluginCatalogService(deps: {
  db: DbConnection;
  appVersion: string;
  plugins: Pick<PluginService, "installOfficialPlugin" | "isEnabled">;
  officialPlugins?: readonly BundledPluginRegistration[];
  warn?: (message: string) => void;
}): PluginCatalogService {
  const officialPlugins = (
    deps.officialPlugins ??
    listBundledPluginRegistrations().filter((plugin) => !plugin.autoInstall)
  ).map((plugin) => ({ ...plugin, category: plugin.category ?? "Other" }));

  // Manifests are read per search so a dev checkout editing a bundled
  // plugin's package.json sees fresh store metadata; four local files is
  // cheap enough not to cache.
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

  function compatibilityProblem(manifest: PluginManifest): string | null {
    const compatibility = evaluateCompatibility({
      bbRange: manifest.bbEngineRange,
      sdkRange: manifest.bbPluginSdkRange,
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
    const problem = compatibilityProblem(manifest);
    return {
      entryId: entry.name,
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

  return {
    status: () => ({ pluginCount: officialPlugins.length }),

    async search(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      const entries = await Promise.all(
        officialPlugins.map(async (entry) => {
          const manifest = await entryManifest(entry);
          return manifest === null
            ? null
            : { pluginId: entry.pluginId, result: searchResult(entry, manifest) };
        }),
      );
      return entries
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
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
    },

    async install(entryId) {
      if (!deps.plugins.isEnabled()) {
        throw new Error(
          'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
        );
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
      const problem = compatibilityProblem(manifest);
      if (problem !== null) {
        throw new Error(`install refused: ${problem}`);
      }
      return deps.plugins.installOfficialPlugin(entry.name);
    },
  };
}
