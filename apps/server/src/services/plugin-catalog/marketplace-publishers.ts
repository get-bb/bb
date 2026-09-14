import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import {
  BUNDLED_MARKETPLACE_NAME,
  BUILTIN_PUBLISHER_LABEL,
} from "./marketplace-manifest.js";

const RESERVED_PUBLISHER_LABELS: ReadonlySet<string> = new Set([
  BUILTIN_PUBLISHER_LABEL,
  "BB Community",
]);

export function marketplacePublisherLabel(args: {
  marketplaceName: string;
  displayName: string;
}): string {
  if (
    args.marketplaceName === CURATED_PLUGIN_MARKETPLACE_NAME ||
    args.marketplaceName === BUNDLED_MARKETPLACE_NAME
  )
    return args.displayName;
  return RESERVED_PUBLISHER_LABELS.has(args.displayName)
    ? args.marketplaceName
    : args.displayName;
}

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
