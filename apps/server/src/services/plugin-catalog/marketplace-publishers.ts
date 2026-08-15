import { listPluginMarketplaces, type DbQueryConnection } from "@bb/db";
import {
  BUILTIN_PUBLISHER_LABEL,
  CURATED_MARKETPLACE_NAME,
  parseMarketplaceManifestJson,
} from "./marketplace-manifest.js";

/**
 * Publisher labels only BB may present. A marketplace names itself, so without
 * this a third-party manifest could set `displayName` to `BB Official` and
 * wear the badge that means "ships inside the app". The store falls back to the
 * marketplace's own name, which is unique and cannot be chosen freely.
 */
const RESERVED_PUBLISHER_LABELS: ReadonlySet<string> = new Set([
  BUILTIN_PUBLISHER_LABEL,
  "BB Community",
]);

/**
 * What a marketplace may call itself. Only the marketplace BB curates may
 * present a reserved label.
 */
export function marketplacePublisherLabel(args: {
  marketplaceName: string;
  displayName: string;
}): string {
  if (args.marketplaceName === CURATED_MARKETPLACE_NAME) return args.displayName;
  return RESERVED_PUBLISHER_LABELS.has(args.displayName)
    ? args.marketplaceName
    : args.displayName;
}

/**
 * Publisher badge for every registered marketplace, keyed by marketplace name.
 * The plugin list renders this beside a plugin's name, so it must resolve
 * without a catalog refresh: the stored manifest is the only source, and a
 * marketplace whose document no longer parses falls back to its name rather
 * than dropping the badge.
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
    labels.set(
      row.name,
      marketplacePublisherLabel({
        marketplaceName: row.name,
        displayName,
      }),
    );
  }
  return labels;
}

/**
 * Publisher badge for one installed plugin.
 *
 * Keyed on the source, not the provenance: a bundled plugin the user opted
 * into from the store is recorded as a catalog install of the bundled entry,
 * so reading provenance alone flipped its badge from `BB Official` to the
 * marketplace's name the moment it was installed. A plugin the user added from
 * a source has no publisher bb can vouch for, so it gets none.
 */
export function pluginPublisherLabel(args: {
  sourceKind: "path" | "builtin" | "npm" | "git";
  provenance: "builtin" | "direct" | "catalog";
  catalogMarketplaceName: string | null;
  labels: ReadonlyMap<string, string>;
}): string | null {
  if (args.sourceKind === "builtin" || args.provenance === "builtin") {
    return BUILTIN_PUBLISHER_LABEL;
  }
  if (args.provenance !== "catalog") return null;
  const name = args.catalogMarketplaceName;
  if (name === null) return null;
  return args.labels.get(name) ?? name;
}
