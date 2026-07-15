import { describe, expect, it } from "vitest";
import {
  pluginCatalogInstallRequestSchema,
  pluginCatalogRefreshRequestSchema,
  pluginCatalogSearchResultSchema,
  pluginCatalogStatusSchema,
} from "../src/index.js";

describe("plugin catalog contracts", () => {
  it("accepts catalog install coordinates without marketplace nesting", () => {
    expect(
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
      }),
    ).toEqual({ entryId: "notes" });
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
        version: "1.2.0",
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        marketplace: { marketplaceId: "official", entryId: "notes" },
      }),
    ).toThrow();
  });

  it("requires refresh requests to be a strict empty object", () => {
    expect(pluginCatalogRefreshRequestSchema.parse({})).toEqual({});
    expect(() =>
      pluginCatalogRefreshRequestSchema.parse({ force: true }),
    ).toThrow();
  });

  it("requires explicit nullable catalog status and search fields", () => {
    expect(
      pluginCatalogStatusSchema.parse({
        pluginCount: 3,
        lastRefreshAt: null,
        lastAttemptAt: null,
        lastError: null,
      }),
    ).toEqual({
      pluginCount: 3,
      lastRefreshAt: null,
      lastAttemptAt: null,
      lastError: null,
    });
    expect(() => pluginCatalogStatusSchema.parse({ pluginCount: 3 })).toThrow();

    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        entryId: "notes",
        displayName: "Notes",
        description: "Notes",
        icon: null,
        source: "npm:notes",
        installed: false,
        compatible: true,
      }),
    ).toThrow();
  });
});
