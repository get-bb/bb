import { describe, expect, it } from "vitest";

import {
  loadPublicMarketplace,
  MARKETPLACE_STATS_PATH,
  MARKETPLACE_V2_MANIFEST_PATH,
} from "./marketplace-data.js";
import { marketplaceResponseStatus } from "./marketplace-response-status.js";
import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";

describe("loadPublicMarketplace", () => {
  it("sets status 503 when the v2 document cannot load", async () => {
    const marketplace = await loadPublicMarketplace(async () => {
      throw new Error("offline");
    });
    expect(marketplace).toEqual({ status: "unavailable" });
    expect(marketplaceResponseStatus("/marketplace", [marketplace])).toBe(503);
  });

  it("keeps the normal status when the v2 document loads", () => {
    expect(
      marketplaceResponseStatus("/marketplace/author/acme-tools", [
        {
          status: "available",
          manifest: MARKETPLACE_V2_FIXTURE,
          stats: MARKETPLACE_STATS_FIXTURE,
        },
      ]),
    ).toBeNull();
  });

  it("does not change another route status", () => {
    expect(
      marketplaceResponseStatus("/dashboard", [{ status: "unavailable" }]),
    ).toBeNull();
  });

  it("keeps the catalog available when only stats fail", async () => {
    await expect(
      loadPublicMarketplace(async (path) => {
        if (path === MARKETPLACE_V2_MANIFEST_PATH) {
          return MARKETPLACE_V2_FIXTURE;
        }
        throw new Error("stats offline");
      }),
    ).resolves.toEqual({
      status: "available",
      manifest: MARKETPLACE_V2_FIXTURE,
      stats: null,
    });
  });

  it("loads v2 and stats through their public paths", async () => {
    const paths: string[] = [];
    const data = await loadPublicMarketplace(async (path) => {
      paths.push(path);
      return path === MARKETPLACE_STATS_PATH
        ? MARKETPLACE_STATS_FIXTURE
        : MARKETPLACE_V2_FIXTURE;
    });
    expect(paths).toEqual([
      MARKETPLACE_V2_MANIFEST_PATH,
      MARKETPLACE_STATS_PATH,
    ]);
    expect(data).toEqual({
      status: "available",
      manifest: MARKETPLACE_V2_FIXTURE,
      stats: MARKETPLACE_STATS_FIXTURE,
    });
  });
});
