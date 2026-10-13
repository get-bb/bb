import { describe, expect, it } from "vitest";

import {
  BUILTIN_PLUGINS,
  OFFICIAL_PLUGINS,
} from "../../../server/src/services/plugins/builtin-registry.js";
import {
  bundledMarketplace,
  bundledPluginSetup,
  INSTALL_ON_REQUEST_BUNDLED_PLUGINS,
  OFF_BY_DEFAULT_BUNDLED_PLUGINS,
  UNLISTED_BUNDLED_PLUGINS,
  withBundledPlugins,
} from "./bundled-marketplace.js";
import { marketplacePluginIcon } from "./marketplace-icons.js";
import { MARKETPLACE_V2_FIXTURE } from "./marketplace-v2.fixture.js";
import type {
  MarketplaceV2Entry,
  MarketplaceV2Manifest,
} from "./marketplace-v2.js";

function bundledEntry(
  id: string,
  plugin: string,
  overrides: Partial<MarketplaceV2Entry> = {},
): MarketplaceV2Entry {
  return {
    id,
    displayName: id,
    description: `The ${id} plugin.`,
    icon: "Brain",
    category: "memory-and-context",
    screenshots: [],
    tags: [],
    author: { name: "BB" },
    source: { bundled: { plugin } },
    ...overrides,
  };
}

const BUNDLED_FIXTURE: MarketplaceV2Manifest = {
  ...MARKETPLACE_V2_FIXTURE,
  name: "bb-official",
  displayName: "BB Official",
  categories: [
    {
      id: "memory-and-context",
      displayName: "Memory & Context",
      description: "Remember context.",
    },
    {
      id: "environments",
      displayName: "Environments",
      description: "Run threads in environments.",
    },
    {
      id: "code-and-reviews",
      displayName: "Bundled code",
      description: "Bundled code.",
    },
  ],
  collections: [
    {
      id: "bb-official",
      displayName: "BB Official",
      pluginIds: ["memory", "prompt-library", "provider-codex", "guide"],
    },
  ],
  plugins: [
    bundledEntry("memory", "memory"),
    bundledEntry("prompt-library", "prompt-library"),
    bundledEntry("provider-codex", "provider-codex", {
      category: "environments",
    }),
    bundledEntry("guide", "plugin-api-docs", {
      icon: { url: "./plugin-api-docs/icons/guide.svg" },
    }),
  ],
};

describe("withBundledPlugins", () => {
  const merged = withBundledPlugins(MARKETPLACE_V2_FIXTURE, BUNDLED_FIXTURE, {
    "../../../../plugins/plugin-api-docs/icons/guide.svg":
      "/assets/guide-abc.svg",
  });

  it("keeps the community plugin on an id clash and drops unlisted plugins", () => {
    const bundledIds = merged.plugins
      .filter((entry) => "bundled" in entry.source)
      .map((entry) => entry.id);
    expect(bundledIds).toEqual(["memory", "guide"]);
    expect(
      merged.plugins.filter((entry) => entry.id === "prompt-library"),
    ).toEqual(
      MARKETPLACE_V2_FIXTURE.plugins.filter(
        (entry) => entry.id === "prompt-library",
      ),
    );
  });

  it("places the bundled shelf before the community collections", () => {
    expect(merged.collections.map((collection) => collection.id)).toEqual([
      "bb-official",
      "new-and-notable",
    ]);
    expect(merged.collections[0]?.pluginIds).toEqual(["memory", "guide"]);
  });

  it("adds only missing categories that listed bundled plugins use", () => {
    expect(merged.categories.map((category) => category.id)).toEqual([
      "thread-content",
      "code-and-reviews",
      "memory-and-context",
    ]);
  });

  it("resolves local icons and falls back when an icon is not bundled", () => {
    expect(merged.plugins.at(-1)?.icon).toEqual({
      url: "/assets/guide-abc.svg",
    });
    const fallback = withBundledPlugins(
      MARKETPLACE_V2_FIXTURE,
      BUNDLED_FIXTURE,
      {},
    );
    expect(fallback.plugins.at(-1)?.icon).toBe("Puzzle");
  });
});

describe("bundled plugin setup", () => {
  it("matches how the server registry installs and enables each plugin", () => {
    const listed = (plugins: readonly { name: string }[]) =>
      plugins
        .map((plugin) => plugin.name)
        .filter((name) => !UNLISTED_BUNDLED_PLUGINS.has(name))
        .sort();
    expect([...INSTALL_ON_REQUEST_BUNDLED_PLUGINS].sort()).toEqual(
      listed(OFFICIAL_PLUGINS),
    );
    expect([...OFF_BY_DEFAULT_BUNDLED_PLUGINS].sort()).toEqual(
      listed(BUILTIN_PLUGINS.filter((plugin) => !plugin.defaultEnabled)),
    );
  });

  it("has a web icon for every listed plugin", () => {
    const declared = new Map(
      bundledMarketplace().plugins.map((entry) => [entry.id, entry.icon]),
    );
    const listed = withBundledPlugins(
      { ...MARKETPLACE_V2_FIXTURE, plugins: [], collections: [] },
      bundledMarketplace(),
    ).plugins;
    const fallback = marketplacePluginIcon("Puzzle");
    expect(
      listed
        .filter((entry) => {
          const icon = declared.get(entry.id);
          return typeof icon === "string"
            ? icon !== "Puzzle" && marketplacePluginIcon(icon) === fallback
            : typeof entry.icon === "string";
        })
        .map((entry) => entry.id),
    ).toEqual([]);
  });

  it("uses the source name for install commands", () => {
    const docs = bundledMarketplace().plugins.find(
      (entry) => entry.id === "simple-notes",
    );
    expect(docs && bundledPluginSetup(docs)).toEqual({
      kind: "install",
      command: "bb plugin install docs",
    });
    const guide = bundledMarketplace().plugins.find(
      (entry) => entry.id === "bb-guide",
    );
    expect(guide && bundledPluginSetup(guide)).toEqual({ kind: "included" });
  });
});
