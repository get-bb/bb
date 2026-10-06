import bundledCatalog from "../../../server/src/generated/bb-official-marketplace/marketplace.json";

import {
  parseBundledMarketplaceManifest,
  type MarketplaceV2Entry,
  type MarketplaceV2Manifest,
} from "./marketplace-v2.js";

export const UNLISTED_BUNDLED_PLUGINS: ReadonlySet<string> = new Set([
  "account-pool",
  "agent-annotations",
  "environment-git-worktree",
  "environment-personal-workspace",
  "environment-project-checkout",
  "plugin-api-tester",
  "provider-acp",
  "provider-claude-code",
  "provider-codex",
  "provider-pi",
]);

export const INSTALL_ON_REQUEST_BUNDLED_PLUGINS: ReadonlySet<string> = new Set([
  "browser-automation",
  "docs",
  "environment-modal-sandbox",
  "github",
  "memory",
  "tasks",
  "theme-preview",
]);

export const OFF_BY_DEFAULT_BUNDLED_PLUGINS: ReadonlySet<string> = new Set([
  "ask-user-question",
  "monaco-editor",
  "plugin-api-docs",
  "prompt-library",
  "workflows",
]);

export type BundledPluginSetup =
  | { kind: "included" }
  | { kind: "install" | "enable"; command: string };

const BUNDLED_ICON_URLS = import.meta.glob<string>(
  "../../../../plugins/*/{icons/*.svg,*.svg}",
  { query: "?url", import: "default", eager: true },
);

export function bundledPluginName(entry: MarketplaceV2Entry): string | null {
  return "bundled" in entry.source ? entry.source.bundled.plugin : null;
}

export function bundledPluginSetup(
  entry: MarketplaceV2Entry,
): BundledPluginSetup | null {
  const name = bundledPluginName(entry);
  if (name === null) return null;
  if (INSTALL_ON_REQUEST_BUNDLED_PLUGINS.has(name)) {
    return { kind: "install", command: `bb plugin install ${name}` };
  }
  if (OFF_BY_DEFAULT_BUNDLED_PLUGINS.has(name)) {
    return { kind: "enable", command: `bb plugin enable ${entry.id}` };
  }
  return { kind: "included" };
}

function bundledIcon(
  icon: MarketplaceV2Entry["icon"],
  iconUrls: Readonly<Record<string, string>>,
): MarketplaceV2Entry["icon"] {
  if (typeof icon === "string") return icon;
  const url = iconUrls[`../../../../plugins/${icon.url.replace(/^\.\//u, "")}`];
  return url === undefined ? "Puzzle" : { url };
}

export function withBundledPlugins(
  community: MarketplaceV2Manifest,
  bundled: MarketplaceV2Manifest,
  iconUrls: Readonly<Record<string, string>> = BUNDLED_ICON_URLS,
): MarketplaceV2Manifest {
  const communityIds = new Set(community.plugins.map((entry) => entry.id));
  const plugins = bundled.plugins.flatMap((entry) => {
    const name = bundledPluginName(entry);
    if (name === null || UNLISTED_BUNDLED_PLUGINS.has(name)) return [];
    if (communityIds.has(entry.id)) return [];
    return [{ ...entry, icon: bundledIcon(entry.icon, iconUrls) }];
  });
  const listedIds = new Set(plugins.map((entry) => entry.id));
  const categoryIds = new Set(
    community.categories.map((category) => category.id),
  );
  const usedCategories = new Set(plugins.map((entry) => entry.category));
  const categories = [
    ...community.categories,
    ...bundled.categories.filter(
      (category) =>
        !categoryIds.has(category.id) && usedCategories.has(category.id),
    ),
  ];
  const collections = bundled.collections.flatMap((collection) => {
    const pluginIds = collection.pluginIds.filter((id) => listedIds.has(id));
    return pluginIds.length === 0 ? [] : [{ ...collection, pluginIds }];
  });
  return {
    ...community,
    categories,
    collections: [...collections, ...community.collections],
    plugins: [...community.plugins, ...plugins],
  };
}

let parsedBundledMarketplace: MarketplaceV2Manifest | undefined;

export function bundledMarketplace(): MarketplaceV2Manifest {
  parsedBundledMarketplace ??= parseBundledMarketplaceManifest(bundledCatalog);
  return parsedBundledMarketplace;
}
