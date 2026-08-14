import { listPluginMarketplaces, type DbQueryConnection } from "@bb/db";
import {
  BUILTIN_PUBLISHER_LABEL,
  parseMarketplaceManifestJson,
} from "./marketplace-manifest.js";

/**
 * Publisher badge for every installed plugin, keyed by the marketplace that
 * listed it. The plugin list renders this beside a plugin's name, so it must
 * resolve without a catalog refresh: the stored manifest is the only source,
 * and a marketplace whose document no longer parses falls back to its name
 * rather than dropping the badge.
 */
export function marketplacePublisherLabels(
  db: DbQueryConnection,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const row of listPluginMarketplaces(db)) {
    let displayName = row.name;
    try {
      displayName = parseMarketplaceManifestJson(
        row.manifestJson,
        `stored "${row.name}" marketplace catalog`,
      ).displayName;
    } catch {
      // A corrupt document is already reported by the catalog service; here it
      // only costs the prettier name.
    }
    labels.set(row.name, displayName);
  }
  return labels;
}

/**
 * Publisher badge for one installed plugin. A plugin the user added from a
 * source has no publisher bb can vouch for, so it gets none.
 */
export function pluginPublisherLabel(args: {
  provenance: "builtin" | "direct" | "catalog";
  catalogMarketplaceName: string | null;
  labels: ReadonlyMap<string, string>;
}): string | null {
  if (args.provenance === "builtin") return BUILTIN_PUBLISHER_LABEL;
  if (args.provenance !== "catalog") return null;
  const name = args.catalogMarketplaceName;
  if (name === null) return null;
  return args.labels.get(name) ?? name;
}
