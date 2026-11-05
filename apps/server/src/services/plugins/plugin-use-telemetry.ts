import {
  deletePluginRecommendationId,
  getInstalledPlugin,
  getPluginRecommendationId,
  setPluginRecommendationId,
  type DbConnection,
  type InstalledPluginRow,
} from "@bb/db";
import { isPublicPluginProvenance } from "./plugin-registration.js";
import type { PluginServiceDeps } from "./plugin-service-internal.js";

type PluginUseTelemetryDeps = Pick<PluginServiceDeps, "db" | "telemetry">;

const usesCountedToday = new WeakMap<DbConnection, Map<string, string>>();

function countedUses(db: DbConnection): Map<string, string> {
  let counted = usesCountedToday.get(db);
  if (counted === undefined) {
    counted = new Map();
    usesCountedToday.set(db, counted);
  }
  return counted;
}

function isMeasurablePlugin(
  row: InstalledPluginRow | undefined,
): row is InstalledPluginRow {
  return (
    row?.enabled === true &&
    isPublicPluginProvenance(row.provenance, row.catalogMarketplaceName)
  );
}

export function rememberPluginRecommendation(
  deps: PluginUseTelemetryDeps,
  pluginId: string,
  recommendationId: string,
): void {
  if (!deps.telemetry.isEnabled()) return;
  setPluginRecommendationId(deps.db, pluginId, recommendationId);
  countedUses(deps.db).delete(pluginId);
}

export function forgetPluginRecommendation(
  db: DbConnection,
  pluginId: string,
): void {
  deletePluginRecommendationId(db, pluginId);
}

export function capturePluginUse(
  deps: PluginUseTelemetryDeps,
  pluginId: string,
): void {
  const today = new Date().toISOString().slice(0, 10);
  const counted = countedUses(deps.db);
  if (!deps.telemetry.isEnabled() || counted.get(pluginId) === today) return;
  if (!isMeasurablePlugin(getInstalledPlugin(deps.db, pluginId))) return;
  counted.set(pluginId, today);
  deps.telemetry.capture({
    name: "plugin_use",
    properties: { plugin_id: pluginId },
  });
  const recommendationId = getPluginRecommendationId(deps.db, pluginId);
  if (recommendationId === null) return;
  forgetPluginRecommendation(deps.db, pluginId);
  deps.telemetry.capture({
    name: "recommendation",
    properties: {
      resource_type: "plugin",
      resource_id: pluginId,
      recommendation_id: recommendationId,
      action: "used",
    },
  });
}
