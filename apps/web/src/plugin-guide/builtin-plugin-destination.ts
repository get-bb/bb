import { bundledPluginName } from "../marketplace/bundled-marketplace.js";
import type { PublicMarketplaceData } from "../marketplace/marketplace-data.js";

const PLUGIN_SOURCE_ROOT = "https://github.com/get-bb/bb/tree/main/plugins/";

export type BuiltinPluginDestination =
  | { kind: "marketplace"; pluginId: string }
  | { kind: "source"; href: string };

export function builtinPluginDestination(
  marketplace: PublicMarketplaceData,
  plugin: string,
): BuiltinPluginDestination {
  const entry =
    marketplace.status === "available"
      ? marketplace.manifest.plugins.find(
          (candidate) => bundledPluginName(candidate) === plugin,
        )
      : undefined;
  return entry
    ? { kind: "marketplace", pluginId: entry.id }
    : {
        kind: "source",
        href: `${PLUGIN_SOURCE_ROOT}${encodeURIComponent(plugin)}`,
      };
}
