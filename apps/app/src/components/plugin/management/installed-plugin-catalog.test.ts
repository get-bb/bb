import { describe, expect, it } from "vitest";
import { installedPluginCatalogEntry } from "./installed-plugin-catalog";

const community = {
  pluginId: "notes",
  entryId: "notes",
  marketplace: "community",
  source: "git:https://github.com/alice/notes.git@v2",
};
const official = {
  ...community,
  marketplace: "bb-official",
  source: "builtin:notes",
};

describe("installed plugin catalog identity", () => {
  it("uses the recorded marketplace when another listing shares its IDs", () => {
    expect(
      installedPluginCatalogEntry(
        {
          id: "notes",
          catalogEntryId: "notes",
          catalogMarketplaceName: "community",
          source: "git:https://github.com/alice/notes.git@v1",
        },
        [official, community],
        { allowSourceFallback: false },
      ),
    ).toBe(community);
  });
  it("does not give a direct or local plugin another author's catalog identity", () => {
    for (const source of [
      "git:https://github.com/bob/notes.git",
      "path:/workspace/notes",
    ]) {
      expect(
        installedPluginCatalogEntry(
          {
            id: "notes",
            catalogEntryId: null,
            catalogMarketplaceName: null,
            source,
          },
          [official, community],
        ),
      ).toBeUndefined();
    }
  });
  it("matches a bundled plugin by its source without marketplace installation metadata", () => {
    expect(
      installedPluginCatalogEntry(
        {
          id: "notes",
          catalogEntryId: null,
          catalogMarketplaceName: null,
          source: "builtin:notes",
        },
        [{ ...official, marketplace: "untrusted" }, community, official],
        { allowSourceFallback: false },
      ),
    ).toBe(official);
  });
  it("requires complete installation metadata when source fallback is disabled", () => {
    for (const metadata of [
      { catalogEntryId: null, catalogMarketplaceName: null },
      { catalogEntryId: "notes", catalogMarketplaceName: null },
      { catalogEntryId: null, catalogMarketplaceName: "community" },
    ]) {
      expect(
        installedPluginCatalogEntry(
          { id: "notes", source: community.source, ...metadata },
          [community, official],
          { allowSourceFallback: false },
        ),
      ).toBeUndefined();
    }
  });
});
