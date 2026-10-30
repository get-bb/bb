import { eq } from "drizzle-orm";
import { resolveBundledMarketplaceDirectory } from "../plugin-catalog/bundled-marketplace.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  getInstalledPlugin,
  getPluginKvValue,
  setPluginKvValue,
  deletePluginKvValue,
  pluginKv,
  getPluginMarketplace,
  type InstalledPluginRow,
} from "@bb/db";
import {
  CURATED_PLUGIN_MARKETPLACE_NAME,
  internalPluginUseReportSchema,
  pluginStateChangedTelemetryEventSchema,
  pluginUseTelemetryEventSchema,
  recommendationContextSchema,
  recommendationTelemetryEventSchema,
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
type PluginIdentity = {
  public_plugin: string;
  plugin_source: "builtin" | "public_catalog";
};
const selectionKey = "@bb/recommendation";
const sourceContext = new AsyncLocalStorage<{
  source: PluginMeasurementSource;
  recommendationId: string | null;
}>();
const invocationContext = new AsyncLocalStorage<{
  pluginId: string;
  initiator: PluginUseInitiator;
  observations: Set<string>;
}>();

export function runWithPluginMeasurementSource<T>(
  source: PluginMeasurementSource,
  recommendationId: string | null,
  run: () => T,
): T {
  return sourceContext.run({ source, recommendationId }, run);
}

export function resolvePluginMeasurementIdentity(
  deps: Pick<MeasurementDeps, "db" | "watchBuiltinPluginSources">,
  row: InstalledPluginRow,
): PluginIdentity | null {
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
      ? { public_plugin: definition.name, plugin_source: "builtin" }
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
        return sourceMatches && entry !== undefined
          ? { public_plugin: entry.id, plugin_source: "public_catalog" }
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
  const row = getInstalledPlugin(deps.db, pluginId);
  if (!row?.enabled) deletePluginKvValue(deps.db, pluginId, selectionKey);
  if (
    !deps.telemetry.isEnabled() ||
    row === undefined ||
    previous?.enabled === row.enabled
  )
    return;
  const identity = resolvePluginMeasurementIdentity(deps, row);
  if (identity === null) return;
  const event = pluginStateChangedTelemetryEventSchema.parse({
    name: "plugin_state_changed",
    properties: {
      ...identity,
      ...measurementLocation(sourceContext.getStore()?.source ?? "unknown"),
      previous_state:
        previous === undefined
          ? "absent"
          : previous.enabled
            ? "enabled"
            : "disabled",
      state: row.enabled ? "enabled" : "disabled",
    },
  });
  const recommendationId = sourceContext.getStore()?.recommendationId;
  const source = sourceContext.getStore()?.source ?? "unknown";
  const recommendation = recommendationId
    ? {
        resource_type: "plugin" as const,
        resource_id: identity.public_plugin,
        recommendation_id: recommendationId,
        ...measurementLocation(source),
      }
    : null;
  if (row.enabled && recommendation?.resource_id === identity.public_plugin) {
    setPluginKvValue(
      deps.db,
      pluginId,
      selectionKey,
      JSON.stringify(recommendation),
    );
    deps.telemetry.capture(
      recommendationTelemetryEventSchema.parse({
        name: "recommendation",
        properties: { ...recommendation, action: "selected" },
      }),
    );
  } else {
    deps.telemetry.capture(event);
  }
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
  const recommendation = readRecommendation(deps.db, pluginId, selectionKey);
  const successful =
    report.outcome === "succeeded" || report.outcome === "observed";
  if (recommendation && !successful) return;
  if (
    (report.action === "tool_invoked" || report.action === "cli_invoked") &&
    context?.observations.has("successful_use")
  )
    return;
  if (successful) context?.observations.add("successful_use");
  if (recommendation && successful) {
    if (context?.observations.has("recommendation_used")) return;
    context?.observations.add("recommendation_used");
    deps.telemetry.capture(
      recommendationTelemetryEventSchema.parse({
        name: "recommendation",
        properties: { ...recommendation, action: "used" },
      }),
    );
    return;
  }
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
  const community = getPluginMarketplace(db, CURATED_PLUGIN_MARKETPLACE_NAME);
  if (
    community?.sourceKind === "https" &&
    (community.manifestUrl === CURATED_MARKETPLACE_V1_URL ||
      community.manifestUrl === CURATED_MARKETPLACE_V2_URL)
  ) {
    try {
      if (
        parseStoredMarketplaceManifest(community).plugins.some(
          (entry) => entry.id === publicKey,
        )
      )
        return true;
    } catch {}
  }
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
          plugin.name === publicKey,
      );
    });
  } catch {
    return false;
  }
}

function readRecommendation(
  db: MeasurementDeps["db"],
  owner: string,
  key: string,
) {
  const raw = getPluginKvValue(db, owner, key);
  if (raw === undefined) return null;
  try {
    return recommendationContextSchema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
}

export function clearRecommendationAttribution(
  db: MeasurementDeps["db"],
): void {
  db.delete(pluginKv).where(eq(pluginKv.key, selectionKey)).run();
}

function measurementLocation(source: PluginMeasurementSource) {
  return source === "first_run" || source === "replay"
    ? { surface: "onboarding" as const, entry: source }
    : { surface: source, entry: null };
}

export function clearPluginRecommendationAttribution(
  db: MeasurementDeps["db"],
  pluginId: string,
): void {
  deletePluginKvValue(db, pluginId, selectionKey);
}
