import { describe, expect, it } from "vitest";

import {
  type CommunityCatalogRecord,
  searchCommunityPlugins,
} from "./community-catalog";
import { decodeCommunityItemId, utf8ByteLength } from "./mention-context";

function community(
  overrides: Partial<CommunityCatalogRecord> = {},
): CommunityCatalogRecord {
  return {
    author: { name: "Publisher", url: null },
    category: "Developer tools",
    compatible: true,
    description: "Catalog description",
    displayName: "Example",
    entryId: "example-entry",
    icon: null,
    iconTinted: false,
    iconUrl: null,
    incompatibleReason: null,
    installed: false,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    official: false,
    pluginId: "example",
    publisherKey: "publisher",
    publisherLabel: "Publisher",
    repositoryUrl: null,
    source: "git:https://example.test/plugin.git",
    ...overrides,
  };
}

describe("Community eligibility", () => {
  it("keeps only compatible, uninstalled bb-community entries", () => {
    const entries = [
      community({ pluginId: "valid", entryId: "valid", displayName: "Valid" }),
      community({
        pluginId: "installed",
        entryId: "installed",
        installed: true,
      }),
      community({
        pluginId: "incompatible",
        entryId: "incompatible",
        compatible: false,
      }),
      community({
        pluginId: "other-market",
        entryId: "other",
        marketplace: "acme",
      }),
    ];

    expect(
      searchCommunityPlugins(entries, "").map((item) => item.title),
    ).toEqual(["Valid"]);
  });

  it.each([
    { pluginId: " ", entryId: "entry", displayName: "Name" },
    { pluginId: "plugin", entryId: "\u0000\t", displayName: "Name" },
    { pluginId: "plugin", entryId: "entry", displayName: "\u0085 " },
    { pluginId: "界".repeat(200), entryId: "entry", displayName: "Name" },
  ])("rejects malformed normalized identity %#", (overrides) => {
    expect(searchCommunityPlugins([community(overrides)], "")).toEqual([]);
  });
});

describe("Community discovery", () => {
  it("applies identity tiers and preserves host relevance within a tier", () => {
    const entries = [
      community({
        pluginId: "prefix-b",
        entryId: "b",
        displayName: "Git Beta",
      }),
      community({
        pluginId: "substring",
        entryId: "s",
        displayName: "The Git Tool",
      }),
      community({ pluginId: "git", entryId: "id-exact", displayName: "Zulu" }),
      community({
        pluginId: "prefix-a",
        entryId: "a",
        displayName: "Git Alpha",
      }),
      community({ pluginId: "name-exact", entryId: "n", displayName: "Git" }),
    ];

    expect(
      searchCommunityPlugins(entries, "git").map((item) => item.title),
    ).toEqual(["Zulu", "Git", "Git Beta", "Git Alpha", "The Git Tool"]);
  });

  it("keeps catalog-only matches as a fallback instead of discarding them", () => {
    const entry = community({
      pluginId: "noema",
      entryId: "noema",
      displayName: "Noema",
      description: "A memory system",
      category: "Memory",
    });

    expect(
      searchCommunityPlugins([entry], "memory").map((item) => item.title),
    ).toEqual(["Noema"]);
  });

  it("deduplicates stable plugin ids after ranking, keeping the better result", () => {
    const entries = [
      community({
        pluginId: "duplicate",
        entryId: "weak",
        displayName: "The Same Helper",
        description: "First host result",
      }),
      community({
        pluginId: "duplicate",
        entryId: "exact",
        displayName: "Same",
        description: "Better identity match",
      }),
      community({
        pluginId: "other",
        entryId: "other",
        displayName: "Other Same",
      }),
    ];

    const items = searchCommunityPlugins(entries, "same");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Same",
      subtitle: "Not installed · Better identity match",
    });
    expect(decodeCommunityItemId(items[0]!.id).entryId).toBe("exact");
  });

  it("disambiguates duplicate normalized names and starts subtitles with Not installed", () => {
    const entries = [
      community({
        pluginId: "one",
        entryId: "one",
        displayName: "Same   Name",
        description: "First",
      }),
      community({
        pluginId: "two",
        entryId: "two",
        displayName: "same name",
        description: "Second",
      }),
    ];

    const items = searchCommunityPlugins(entries, "");
    expect(items.map((item) => item.subtitle)).toEqual([
      "Not installed · one · First",
      "Not installed · two · Second",
    ]);
  });

  it("uses the publisher label when the description is blank", () => {
    const [item] = searchCommunityPlugins(
      [community({ description: " \t", publisherLabel: "  Acme\nLabs " })],
      "",
    );

    expect(item?.subtitle).toBe("Not installed · Acme Labs");
  });

  it("sanitizes and bounds rows while preserving all opaque identity fields", () => {
    const entry = community({
      pluginId: "plug:in%一",
      marketplace: "bb-community",
      entryId: "entry:50%二",
      displayName: `\u0000 Name\n${"😀".repeat(100)}`,
      description: `\u0085Description\t${"界".repeat(200)}`,
    });
    const [item] = searchCommunityPlugins([entry], "");

    expect(item?.title).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    expect(item?.subtitle).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    expect(utf8ByteLength(item?.title ?? "")).toBeLessThanOrEqual(120);
    expect(utf8ByteLength(item?.subtitle ?? "")).toBeLessThanOrEqual(240);
    expect(decodeCommunityItemId(item?.id ?? "")).toEqual({
      pluginId: "plug:in%一",
      marketplace: "bb-community",
      entryId: "entry:50%二",
    });
  });

  it("returns at most six rows", () => {
    const entries = Array.from({ length: 9 }, (_, index) =>
      community({
        pluginId: `plugin-${index}`,
        entryId: `entry-${index}`,
        displayName: `Plugin ${index}`,
      }),
    );

    expect(searchCommunityPlugins(entries, "")).toHaveLength(6);
  });
});
