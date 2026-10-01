import { describe, expect, it } from "vitest";
import type {
  PluginCatalogSearchData,
  PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import {
  pluginBrowseShelves,
  pluginCategoryFilterOptions,
} from "./plugin-browse-discovery";

function entry(
  id: string,
  overrides: Partial<PluginCatalogSearchEntry> = {},
): PluginCatalogSearchEntry {
  return {
    entryId: id,
    pluginId: id,
    displayName: id,
    description: `${id} description`,
    icon: null,
    iconUrl: null,
    iconTinted: false,
    categoryId: "thread-content",
    category: "Thread Content",
    screenshots: [],
    collections: [],
    source: `builtin:${id}`,
    repositoryUrl: null,
    marketplace: "bb-official",
    marketplaceDisplayName: "BB Official",
    publisherKey: "bb-official",
    publisherLabel: "BB Official",
    official: true,
    author: null,
    installed: false,
    conflictingInstallSource: null,
    installs: null,
    compatible: true,
    incompatibleReason: null,
    ...overrides,
  };
}

describe("plugin browse shelves", () => {
  it("keeps the server collection order before category shelves", () => {
    const official = entry("official", {
      collections: [{ id: "z-server-first", rank: 0 }],
    });
    const notable = entry("notable", {
      collections: [{ id: "a-server-second", rank: 0 }],
    });

    const shelves = pluginBrowseShelves({
      entries: [official, notable],
      collections: [
        {
          id: "z-server-first",
          displayName: "BB Official",
          pluginIds: ["official"],
        },
        {
          id: "a-server-second",
          displayName: "New & notable",
          pluginIds: ["notable"],
        },
      ],
    });

    expect(shelves.map((shelf) => shelf.label)).toEqual([
      "BB Official",
      "New & notable",
      "Thread Content",
    ]);
    expect(shelves[2]?.entries).toEqual([official, notable]);
  });

  it("orders collections, built-in categories, unknown categories, and More plugins", () => {
    const data: PluginCatalogSearchData = {
      entries: [
        entry("unknown-first", {
          categoryId: "observability",
          category: "Observability",
          collections: [{ id: "new-and-notable", rank: 1 }],
        }),
        entry("uncategorized", {
          categoryId: undefined,
          category: undefined,
        }),
        entry("thread", {
          categoryId: "thread-management",
          category: "A server alias",
        }),
        entry("theme", {
          categoryId: "themes-and-appearance",
          category: "Themes & Appearance",
          collections: [{ id: "new-and-notable", rank: 0 }],
        }),
        entry("unknown-second", {
          categoryId: "data-tools",
          category: "Data Tools",
        }),
      ],
      collections: [
        {
          id: "new-and-notable",
          displayName: "New & notable",
          pluginIds: ["theme", "unknown-first"],
        },
      ],
    };

    expect(
      pluginBrowseShelves(data).map((shelf) => [
        shelf.label,
        shelf.entries.map((candidate) => candidate.pluginId),
      ]),
    ).toEqual([
      ["New & notable", ["theme", "unknown-first"]],
      ["Themes & Appearance", ["theme"]],
      ["Thread Management", ["thread"]],
      ["Observability", ["unknown-first"]],
      ["Data Tools", ["unknown-second"]],
      ["More plugins", ["uncategorized"]],
    ]);
  });

  it("uses collection membership when plugin ids match across marketplaces", () => {
    const first = entry("shared", {
      marketplace: "first",
      collections: [{ id: "new-and-notable", rank: 0 }],
    });
    const second = entry("shared", {
      marketplace: "second",
      collections: [],
    });

    const shelves = pluginBrowseShelves({
      entries: [first, second],
      collections: [
        {
          id: "new-and-notable",
          displayName: "New & notable",
          pluginIds: ["shared"],
        },
      ],
    });

    expect(shelves[0]?.entries).toEqual([first]);
  });
});

describe("plugin category filters", () => {
  it("omits missing categories even when previously selected, preserving Local and custom categories", () => {
    expect(
      pluginCategoryFilterOptions(
        [
          entry("categorized"),
          entry("no-category", { categoryId: undefined, category: undefined }),
          entry("no-id", { categoryId: undefined }),
          entry("no-label", { category: undefined }),
          entry("local", { categoryId: "local", category: "Local" }),
          entry("custom", {
            categoryId: "observability",
            category: "Observability",
          }),
        ],
        ["uncategorized"],
      ),
    ).toEqual([
      { id: "thread-content", label: "Thread Content", count: 1 },
      { id: "local", label: "Local", count: 1 },
      { id: "observability", label: "Observability", count: 1 },
    ]);
  });
});
