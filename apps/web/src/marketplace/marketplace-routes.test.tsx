import { isNotFound, isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { stringifySiteSearch } from "../lib/search-serialization.js";
import {
  createPublicMarketplaceCache,
  type PublicMarketplaceData,
} from "./marketplace-data.js";
import {
  marketplaceHtmlCacheControl,
  marketplaceResponseStatus,
} from "./marketplace-response-status.js";
import {
  marketplaceAuthorRouteEntries,
  marketplaceIndexCategory,
  marketplaceIndexMeta,
  marketplacePluginRouteEntry,
  validateMarketplaceSearch,
} from "./marketplace-route-data.js";
import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";

const AVAILABLE_MARKETPLACE: PublicMarketplaceData = {
  status: "available",
  manifest: MARKETPLACE_V2_FIXTURE,
  stats: MARKETPLACE_STATS_FIXTURE,
};

describe("marketplace routes", () => {
  it.each([
    {
      name: "missing object",
      read: async () => {
        throw new Error("missing");
      },
    },
    {
      name: "invalid object",
      read: async () => ({ schemaVersion: 2, plugins: "invalid" }),
    },
  ])("returns a noindex 503 for a $name", async ({ read }) => {
    const marketplace = await createPublicMarketplaceCache(async (path) => ({
      etag: path,
      value: await read(),
    }))();
    expect(marketplace).toEqual({ status: "unavailable" });
    expect(marketplaceResponseStatus("/marketplace", [marketplace])).toBe(503);
    expect(marketplaceHtmlCacheControl("/marketplace", 503)).toBe("no-store");
    expect(marketplaceIndexMeta(false)).toContainEqual({
      name: "robots",
      content: "noindex",
    });
  });

  it.each([
    {
      name: "an unknown plugin",
      select: () =>
        marketplacePluginRouteEntry(
          AVAILABLE_MARKETPLACE,
          "missing",
          "/marketplace/missing",
        ),
      location: { to: "/marketplace" },
    },
    {
      name: "an unknown author",
      select: () =>
        marketplaceAuthorRouteEntries(
          AVAILABLE_MARKETPLACE,
          "missing",
          "/marketplace/author/missing",
        ),
      location: { to: "/marketplace" },
    },
    {
      name: "an author in non-canonical case",
      select: () =>
        marketplaceAuthorRouteEntries(
          AVAILABLE_MARKETPLACE,
          "Acme-Tools",
          "/marketplace/author/Acme-Tools",
        ),
      location: {
        to: "/marketplace/author/$github",
        params: { github: "acme-tools" },
      },
    },
  ])("permanently redirects $name", ({ select, location }) => {
    let thrown: unknown;
    try {
      select();
    } catch (error) {
      thrown = error;
    }
    if (!isRedirect(thrown)) throw new Error("The route did not redirect");
    expect(thrown.options).toMatchObject({ ...location, statusCode: 301 });
    expect(thrown.headers.get("cache-control")).toBe("no-store");
  });

  it("returns notFound for paths deeper than a plugin or author", () => {
    for (const select of [
      () =>
        marketplacePluginRouteEntry(
          AVAILABLE_MARKETPLACE,
          "missing",
          "/marketplace/missing/extra",
        ),
      () =>
        marketplaceAuthorRouteEntries(
          AVAILABLE_MARKETPLACE,
          "missing",
          "/marketplace/author/missing/extra",
        ),
    ]) {
      let thrown: unknown;
      try {
        select();
      } catch (error) {
        thrown = error;
      }
      expect(isNotFound(thrown)).toBe(true);
    }
  });

  it("indexes a listed category under its own title and URL", () => {
    const category = marketplaceIndexCategory(
      AVAILABLE_MARKETPLACE,
      "code-and-reviews",
    );
    expect(category?.id).toBe("code-and-reviews");
    expect(marketplaceIndexMeta(true, category)).toEqual(
      expect.arrayContaining([
        { title: "Code & Reviews plugins — bb Plugin Marketplace" },
        {
          property: "og:url",
          content: "https://web.test/marketplace?category=code-and-reviews",
        },
      ]),
    );
    for (const unlisted of ["future-tools", "missing", undefined]) {
      expect(
        marketplaceIndexCategory(AVAILABLE_MARKETPLACE, unlisted),
      ).toBeUndefined();
    }
  });

  it("keeps the first category parameter and round-trips it", () => {
    const first = validateMarketplaceSearch({
      category: ["thread-content", "code-and-reviews"],
      sort: "recently-added",
    });
    expect(first).toEqual({
      category: "thread-content",
      sort: "recently-added",
    });
    const encoded = stringifySiteSearch(first);
    const params = new URLSearchParams(encoded);
    const second = validateMarketplaceSearch({
      category: params.getAll("category"),
      sort: params.get("sort"),
    });
    expect(second).toEqual(first);
    expect(encoded).toBe("?sort=recently-added&category=thread-content");
    expect(validateMarketplaceSearch({})).toEqual({});
    expect(stringifySiteSearch(validateMarketplaceSearch({}))).toBe("");
    expect(stringifySiteSearch({ category: undefined })).toBe("");
  });

  it("keeps an empty catalog available", async () => {
    const marketplace = await createPublicMarketplaceCache(async (path) => ({
      etag: path,
      value: path.endsWith("stats.json")
        ? MARKETPLACE_STATS_FIXTURE
        : { ...MARKETPLACE_V2_FIXTURE, plugins: [] },
    }))();
    expect(marketplace).toMatchObject({
      status: "available",
      manifest: { plugins: [] },
    });
    expect(marketplaceResponseStatus("/marketplace", [marketplace])).toBeNull();
  });
});
