import { resolveBundledMarketplaceDirectory } from "../plugin-catalog/bundled-marketplace.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  getInstalledPlugin,
  getPluginMarketplace,
  type InstalledPluginRow,
} from "@bb/db";
import {
  CURATED_PLUGIN_MARKETPLACE_NAME,
  internalPluginUseReportSchema,
  pluginStateChangedTelemetryEventSchema,
  pluginUseTelemetryEventSchema,
  type PluginMeasurementEvent,
  type PluginMeasurementSource,
  type PluginUseInitiator,
  type PublicMeasurementPlugin,
} from "@bb/server-contract";
import {
  BUNDLED_MARKETPLACE_NAME,
  CURATED_MARKETPLACE_V1_URL,
  CURATED_MARKETPLACE_V2_URL,
  parseStoredMarketplaceManifest,
  isBundledMarketplaceEntry,
} from "../plugin-catalog/marketplace-manifest.js";
import { BUNDLED_PLUGINS } from "./builtin-registry.js";
import type { PluginServiceDeps } from "./plugin-service-internal.js";

type MeasurementDeps = Pick<
  PluginServiceDeps,
  "db" | "telemetry" | "watchBuiltinPluginSources"
>;
type PluginIdentity = Pick<
  PluginMeasurementEvent["properties"],
  "public_plugin" | "plugin_source"
>;
const reviewedPlugins: ReadonlyMap<string, PublicMeasurementPlugin> = new Map([
  ["browser-automation", "browser-automation"],
  ["workflows", "workflows"],
  ["monaco-editor", "monaco-editor"],
  ["bb--prompt-library", "prompt-library"],
  ["agent-annotations", "agent-annotations"],
  ["ask-user-question", "ask-user-question"],
]);
const sourceContext = new AsyncLocalStorage<PluginMeasurementSource>();
const invocationContext = new AsyncLocalStorage<{
  pluginId: string;
  initiator: PluginUseInitiator;
  observations: Set<string>;
}>();

export function runWithPluginMeasurementSource<T>(
  source: PluginMeasurementSource,
  run: () => T,
): T {
  return sourceContext.run(source, run);
}

export function resolvePluginMeasurementIdentity(
  deps: Pick<MeasurementDeps, "db" | "watchBuiltinPluginSources">,
  row: InstalledPluginRow,
): PluginIdentity | null {
  const publicKey = reviewedPlugins.get(row.id);
  if (publicKey === undefined) return null;
  if (
    row.sourceKind === "path" ||
    (row.sourceKind === "builtin" && deps.watchBuiltinPluginSources)
  )
    return null;
  if (row.sourceKind === "builtin") {
    const definition = BUNDLED_PLUGINS.find(
      (plugin) =>
        plugin.pluginId === row.id && plugin.name === row.sourceBuiltinName,
    );
    const official =
      definition !== undefined &&
      (row.provenance === "builtin" ||
        (row.provenance === "catalog" &&
          row.catalogMarketplaceName === BUNDLED_MARKETPLACE_NAME &&
          row.catalogEntryId === definition.name));
    return official
      ? { public_plugin: publicKey, plugin_source: "builtin" }
      : null;
  }
  if (row.provenance === "catalog" && row.catalogMarketplaceName !== null) {
    const marketplace = getPluginMarketplace(
      deps.db,
      row.catalogMarketplaceName,
    );
    if (
      marketplace?.name === CURATED_PLUGIN_MARKETPLACE_NAME &&
      marketplace.sourceKind === "https" &&
      (marketplace.manifestUrl === CURATED_MARKETPLACE_V1_URL ||
        marketplace.manifestUrl === CURATED_MARKETPLACE_V2_URL)
    ) {
      try {
        const manifest = parseStoredMarketplaceManifest(marketplace);
        const entry = manifest.plugins.find(
          (plugin) => plugin.id === row.catalogEntryId,
        );
        const source = entry?.source;
        const sourceMatches =
          source !== undefined &&
          (("npm" in source &&
            row.sourceKind === "npm" &&
            row.sourceNpmPackage === source.npm.package &&
            (row.sourceNpmRegistry ?? "https://registry.npmjs.org") ===
              (source.npm.registry ?? "https://registry.npmjs.org")) ||
            ("git" in source &&
              row.sourceKind === "git" &&
              row.sourceGitUrl === source.git.url &&
              row.sourceGitSubdirectory === (source.git.subdir ?? null)));
        return sourceMatches && entry?.id === publicKey
          ? { public_plugin: publicKey, plugin_source: "public_catalog" }
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

export function capturePluginStateChanged(
  deps: MeasurementDeps,
  pluginId: string,
  previous: InstalledPluginRow | undefined,
): void {
  if (!deps.telemetry.isEnabled()) return;
  const row = getInstalledPlugin(deps.db, pluginId);
  if (row === undefined || previous?.enabled === row.enabled) return;
  const identity = resolvePluginMeasurementIdentity(deps, row);
  if (identity === null) return;
  const event = pluginStateChangedTelemetryEventSchema.parse({
    name: "plugin_state_changed",
    properties: {
      ...identity,
      source: sourceContext.getStore() ?? "unknown",
      previous_state:
        previous === undefined
          ? "absent"
          : previous.enabled
            ? "enabled"
            : "disabled",
      state: row.enabled ? "enabled" : "disabled",
    },
  });
  deps.telemetry.capture(event);
}

export function reportPluginUse(
  deps: MeasurementDeps,
  pluginId: string,
  input: unknown,
): void {
  const report = internalPluginUseReportSchema.parse(input);
  if (!deps.telemetry.isEnabled()) return;
  const row = getInstalledPlugin(deps.db, pluginId);
  if (row === undefined || !row.enabled) return;
  const identity = resolvePluginMeasurementIdentity(deps, row);
  if (identity === null) return;
  const context = invocationContext.getStore();
  const event = pluginUseTelemetryEventSchema.parse({
    name: "plugin_use",
    properties: {
      ...identity,
      action: report.action,
      outcome: report.outcome,
      initiator: context?.initiator ?? report.initiator ?? "unknown",
    },
  });
  const observation = `${pluginId}:${report.action}:${report.outcome}`;
  if (context?.observations.has(observation)) return;
  context?.observations.add(observation);
  deps.telemetry.capture(event);
}

export function withPluginMeasurementInvocation<T>(
  pluginId: string,
  initiator: PluginUseInitiator,
  run: () => T,
): T {
  const current = invocationContext.getStore();
  if (current?.pluginId === pluginId) return run();
  return invocationContext.run(
    {
      pluginId,
      initiator: current?.initiator ?? initiator,
      observations: new Set(),
    },
    run,
  );
}

export function isReviewedPluginRecommendation(
  db: MeasurementDeps["db"],
  publicKey: PublicMeasurementPlugin,
): boolean {
  const marketplace = getPluginMarketplace(db, BUNDLED_MARKETPLACE_NAME);
  if (
    marketplace?.sourceKind !== "path" ||
    marketplace.manifestUrl !== resolveBundledMarketplaceDirectory()
  )
    return false;
  try {
    const catalog = parseStoredMarketplaceManifest(marketplace);
    return catalog.plugins.some((entry) => {
      if (
        !isBundledMarketplaceEntry(entry) ||
        entry.source.bundled.plugin !== publicKey
      )
        return false;
      return BUNDLED_PLUGINS.some(
        (plugin) =>
          plugin.name === entry.source.bundled.plugin &&
          reviewedPlugins.get(plugin.pluginId) === publicKey,
      );
    });
  } catch {
    return false;
  }
}
