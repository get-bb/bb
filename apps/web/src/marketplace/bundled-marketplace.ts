import bundledCatalog from "../../../server/src/generated/bb-official-marketplace/marketplace.json";

import {
  parseMarketplaceV2Manifest,
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
    return { kind: "enable", command: `bb plugin enable ${name}` };
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

function publicBundledId(id: string, communityIds: ReadonlySet<string>) {
  if (!communityIds.has(id)) return id;
  const compact = id.replaceAll("-", "");
  return communityIds.has(compact) ? null : compact;
}

export function withBundledPlugins(
  community: MarketplaceV2Manifest,
  bundled: MarketplaceV2Manifest,
  iconUrls: Readonly<Record<string, string>> = BUNDLED_ICON_URLS,
): MarketplaceV2Manifest {
  const communityIds = new Set(community.plugins.map((entry) => entry.id));
  const publicIds = new Map<string, string>();
  const plugins = bundled.plugins.flatMap((entry) => {
    const name = bundledPluginName(entry);
    if (name === null || UNLISTED_BUNDLED_PLUGINS.has(name)) return [];
    const id = publicBundledId(entry.id, communityIds);
    if (id === null) return [];
    publicIds.set(entry.id, id);
    return [{ ...entry, id, icon: bundledIcon(entry.icon, iconUrls) }];
  });
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
    const pluginIds = collection.pluginIds.flatMap((pluginId) => {
      const id = publicIds.get(pluginId);
      return id === undefined ? [] : [id];
    });
    return pluginIds.length === 0 ? [] : [{ ...collection, pluginIds }];
  });
  const [lead, ...rest] = community.collections;
  return {
    ...community,
    categories,
    collections:
      lead === undefined ? collections : [lead, ...collections, ...rest],
    plugins: [...community.plugins, ...plugins],
  };
}

let parsedBundledMarketplace: MarketplaceV2Manifest | undefined;

export function bundledMarketplace(): MarketplaceV2Manifest {
  parsedBundledMarketplace ??= parseMarketplaceV2Manifest(bundledCatalog);
  return parsedBundledMarketplace;
}
