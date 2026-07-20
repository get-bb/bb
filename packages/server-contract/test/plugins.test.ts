import { describe, expect, it } from "vitest";
import {
  pluginCatalogInstallRequestSchema,
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

  it("keeps status to the bundled plugin count and search fields required", () => {
    expect(pluginCatalogStatusSchema.parse({ pluginCount: 4 })).toEqual({
      pluginCount: 4,
    });
    // Refresh-era freshness fields no longer survive parsing.
    expect(
      pluginCatalogStatusSchema.parse({ pluginCount: 4, lastError: null }),
    ).toEqual({ pluginCount: 4 });

    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        entryId: "notes",
        displayName: "Notes",
        description: "Notes",
        icon: null,
        category: "Productivity",
        source: "builtin:notes",
        installed: false,
        compatible: true,
        incompatibleReason: null,
      }),
    ).toThrow();
  });
});
