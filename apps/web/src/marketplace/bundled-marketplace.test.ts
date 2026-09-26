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

  it("renames ids that clash with community plugins and drops unlisted ones", () => {
    const bundledIds = merged.plugins
      .filter((entry) => "bundled" in entry.source)
      .map((entry) => entry.id);
    expect(bundledIds).toEqual(["memory", "promptlibrary", "guide"]);
    expect(
      merged.plugins.filter((entry) => entry.id === "prompt-library"),
    ).toHaveLength(1);
  });

  it("skips a bundled plugin whose compact id also clashes", () => {
    const community = {
      ...MARKETPLACE_V2_FIXTURE,
      plugins: [
        ...MARKETPLACE_V2_FIXTURE.plugins,
        { ...MARKETPLACE_V2_FIXTURE.plugins[0]!, id: "promptlibrary" },
      ],
    };
    const ids = withBundledPlugins(community, BUNDLED_FIXTURE, {}).plugins.map(
      (entry) => entry.id,
    );
    expect(ids.filter((id) => id === "promptlibrary")).toHaveLength(1);
  });

  it("places the bundled shelf after the lead community collection", () => {
    expect(merged.collections.map((collection) => collection.id)).toEqual([
      "new-and-notable",
      "bb-official",
    ]);
    expect(merged.collections[1]?.pluginIds).toEqual([
      "memory",
      "promptlibrary",
      "guide",
    ]);
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
    for (const plugin of OFFICIAL_PLUGINS) {
      expect(INSTALL_ON_REQUEST_BUNDLED_PLUGINS.has(plugin.name)).toBe(
        !UNLISTED_BUNDLED_PLUGINS.has(plugin.name),
      );
    }
    for (const plugin of BUILTIN_PLUGINS) {
      if (UNLISTED_BUNDLED_PLUGINS.has(plugin.name)) continue;
      expect(OFF_BY_DEFAULT_BUNDLED_PLUGINS.has(plugin.name)).toBe(
        !plugin.defaultEnabled,
      );
    }
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
