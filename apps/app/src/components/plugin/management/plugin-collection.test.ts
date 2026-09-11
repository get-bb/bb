import { describe, expect, it } from "vitest";
import type { PluginListingRecord } from "@bb/server-contract";
import { makePluginListItem } from "@/test/fixtures/plugins";
import {
  mergePluginCollection,
  pluginCollectionCategory,
} from "./plugin-collection";

const listing: PluginListingRecord = {
  pluginId: "review-notes",
  authorship: "explicit",
  entry: {
    id: "review-notes",
    displayName: "Review Notes",
    description: "Review your work.",
    icon: "Notebook",
    category: "code-and-reviews",
    author: { name: "Sam", github: "sam" },
    source: {
      git: { url: "https://github.com/sam/review-notes", ref: "main" },
    },
  },
  lifecycle: { status: "draft" },
};

describe("Installed plugin collection", () => {
  it("merges explicit authored metadata into an installed plugin without inflating the total", () => {
    const runtime = makePluginListItem({
      id: listing.pluginId,
      source: "path:/plugins/review-notes",
    });
    const collection = mergePluginCollection({
      plugins: [runtime],
      listings: [listing],
      catalogEntries: [],
    });
    expect(collection).toEqual([
      { pluginId: listing.pluginId, runtime, listing, catalogEntry: null },
    ]);
    expect(pluginCollectionCategory(collection[0]!)).toEqual({
      id: "code-and-reviews",
      label: "Code & Reviews",
    });
  });

  it("keeps authored-only entries without inventing an installed runtime and never infers authorship from paths", () => {
    const thirdParty = makePluginListItem({
      id: "downloaded-local",
      source: "path:/plugins/downloaded-local",
    });
    const collection = mergePluginCollection({
      plugins: [thirdParty],
      listings: [listing],
      catalogEntries: [],
    });
    expect(collection).toHaveLength(2);
    expect(
      collection.find((entry) => entry.pluginId === thirdParty.id)?.listing,
    ).toBeNull();
    expect(
      collection.find((entry) => entry.pluginId === listing.pluginId)?.runtime,
    ).toBeNull();
  });
});
