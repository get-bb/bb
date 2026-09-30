import { isNotFound } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
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
  marketplaceIndexMeta,
  marketplacePluginRouteEntry,
  validateMarketplaceSearch,
} from "./marketplace-route-data.js";
import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import { PublicMarketplaceUnavailablePage } from "./public-marketplace.js";

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
    expect(
      renderToStaticMarkup(<PublicMarketplaceUnavailablePage />),
    ).toContain("The Marketplace is not available");
  });

  it("returns notFound for an unknown plugin and author", () => {
    for (const select of [
      () => marketplacePluginRouteEntry(AVAILABLE_MARKETPLACE, "missing"),
      () => marketplaceAuthorRouteEntries(AVAILABLE_MARKETPLACE, "missing"),
    ]) {
      try {
        select();
        throw new Error("The route did not return notFound");
      } catch (error) {
        expect(isNotFound(error)).toBe(true);
      }
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
