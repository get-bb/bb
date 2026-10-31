import { describe, expect, it } from "vitest";
import {
  parseBundledMarketplaceManifest,
  parseMarketplaceManifest,
} from "../../../src/services/plugin-catalog/marketplace-manifest.js";
import {
  findBuiltinMarketplacePage,
  findMarketplacePage,
  marketplacePageUrl,
  type MarketplacePageCatalogs,
} from "../../../src/services/plugin-catalog/marketplace-pages.js";

function bundledEntry(
  id: string,
  plugin: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    displayName: id,
    description: `The ${id} plugin.`,
    icon: "Puzzle",
    author: { name: "BB" },
    source: { bundled: { plugin } },
    ...extra,
  };
}

function communityEntry(id: string) {
  return {
    id,
    displayName: id,
    description: `The ${id} plugin.`,
    icon: "Puzzle",
    author: { name: "Someone" },
    source: { npm: { package: `bb-plugin-${id}` } },
  };
}

const CATALOGS: MarketplacePageCatalogs = {
  official: parseBundledMarketplaceManifest(
    {
      schemaVersion: 2,
      name: "bb-official",
      displayName: "BB Official",
      plugins: [
        bundledEntry("simple-notes", "docs"),
        bundledEntry("provider-codex", "provider-codex", { unlisted: true }),
        bundledEntry("linear-sync", "linear-sync"),
      ],
    },
    "official fixture",
  ),
  community: parseMarketplaceManifest(
    {
      schemaVersion: 2,
      name: "bb-community",
      displayName: "BB Community",
      plugins: [communityEntry("acme-widgets"), communityEntry("linear-sync")],
    },
    "community fixture",
  ),
};

describe("marketplace pages", () => {
  it("builds the share link with the bb share marker", () => {
    expect(marketplacePageUrl("bb--git")).toBe(
      "https://getbb.app/marketplace/bb--git?utm_source=bb&utm_medium=share",
    );
  });

  it("resolves an official entry by entry id or built-in name to its page id", () => {
    const page = {
      marketplace: "bb-official",
      entryId: "simple-notes",
      pluginId: "simple-notes",
      url: marketplacePageUrl("simple-notes"),
    };
    expect(findMarketplacePage(CATALOGS, "bb-official", "simple-notes")).toEqual(
      page,
    );
    expect(findMarketplacePage(CATALOGS, "bb-official", "docs")).toEqual(page);
    expect(findBuiltinMarketplacePage(CATALOGS, "docs")).toEqual(page);
  });

  it("resolves a BB Community entry", () => {
    expect(
      findMarketplacePage(CATALOGS, "bb-community", "acme-widgets"),
    ).toMatchObject({
      marketplace: "bb-community",
      entryId: "acme-widgets",
      url: marketplacePageUrl("acme-widgets"),
    });
  });

  it.each([
    ["an unlisted official entry", "bb-official", "provider-codex"],
    ["an official entry the website hides behind a community page", "bb-official", "linear-sync"],
    ["an unknown entry", "bb-official", "nope"],
    ["a pair whose entry lives in the other marketplace", "bb-community", "simple-notes"],
    ["a third-party marketplace", "acme", "acme-widgets"],
  ])("has no page for %s", (_label, marketplace, entryId) => {
    expect(findMarketplacePage(CATALOGS, marketplace, entryId)).toBeNull();
  });

  it("has no page when the official catalog is unavailable", () => {
    expect(
      findBuiltinMarketplacePage({ ...CATALOGS, official: null }, "docs"),
    ).toBeNull();
  });
});
