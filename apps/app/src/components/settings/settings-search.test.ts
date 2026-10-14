import { describe, expect, it } from "vitest";
import {
  buildSettingsSearchItems,
  readSettingsSearchAnchor,
  searchSettings,
  SETTINGS_SEARCH_ANCHOR_STATE_KEY,
} from "./settings-search";
import { SETTINGS_NAV_SECTIONS } from "./settings-sections";

const linearPlugin = { icon: null, id: "linear", label: "Linear" };

const allItems = buildSettingsSearchItems({
  conditions: new Set(["fileOpeners"]),
  pluginEntries: [linearPlugin],
  sections: SETTINGS_NAV_SECTIONS,
});

function searchTitles(query: string, items = allItems): string[] {
  return searchSettings(query, items).map((item) =>
    item.context === null ? item.title : `${item.context} › ${item.title}`,
  );
}

describe("searchSettings", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSettings("   ", allItems)).toEqual([]);
  });

  it("ranks a title match above settings that only mention the word", () => {
    expect(searchTitles("theme")).toEqual([
      "Appearance › Theme",
      "Appearance › Palette",
    ]);
  });

  it("finds a setting by a word people remember instead of its title", () => {
    expect(searchTitles("telemetry")).toEqual([
      "General › Share anonymous usage data",
    ]);
    expect(searchTitles("dark mode")).toEqual(["Appearance › Theme"]);
  });

  it("matches words in any order and ignores case and extra spaces", () => {
    expect(searchTitles("  PREFIX   branch ")).toEqual([
      "General › New branch prefix",
    ]);
  });

  it("puts pages ahead of single settings that match equally well", () => {
    expect(searchTitles("a").slice(0, 4)).toEqual([
      "AI services",
      "Appearance",
      "Archived threads",
      "Providers › Allow faster service tiers",
    ]);
  });

  it("lists a section first, then the settings inside it", () => {
    const titles = searchTitles("experiments");
    expect(titles[0]).toBe("Experiments");
    expect(titles).toContain("Experiments › Server move");
  });

  it("points a setting at its section route and carries its anchor", () => {
    const [result] = searchSettings("favicon", allItems);
    expect(result).toMatchObject({
      anchor: "Favicon color",
      to: "/settings/appearance",
    });
  });

  it("finds plugin settings pages by name and by plugin id", () => {
    expect(searchSettings("lin", allItems)[0]).toMatchObject({
      anchor: null,
      title: "Linear",
      to: "/settings/plugins/linear",
    });
    expect(
      searchTitles(
        "acme",
        buildSettingsSearchItems({
          conditions: new Set(),
          pluginEntries: [{ icon: null, id: "acme-tracker", label: "Tracker" }],
          sections: [],
        }),
      ),
    ).toEqual(["Plugin settings › Tracker"]);
  });

  it("leaves out settings whose section is hidden", () => {
    const withoutFiles = buildSettingsSearchItems({
      conditions: new Set(["fileOpeners"]),
      pluginEntries: [],
      sections: SETTINGS_NAV_SECTIONS.filter(
        (section) => section.id !== "files",
      ),
    });
    expect(searchTitles("file openers")).toEqual(["Files › File openers"]);
    expect(searchTitles("file openers", withoutFiles)).toEqual([]);
  });
});

describe("buildSettingsSearchItems", () => {
  it("offers a conditional setting only while its row is on the page", () => {
    const titles = (conditions: ("desktopBrowser" | "diffRenderers")[]) =>
      searchTitles(
        "in-app browser",
        buildSettingsSearchItems({
          conditions: new Set(conditions),
          pluginEntries: [],
          sections: SETTINGS_NAV_SECTIONS,
        }),
      );

    expect(titles(["diffRenderers"])).toEqual([]);
    expect(titles(["desktopBrowser"])).toEqual([
      "General › Open links in the in-app browser",
    ]);
  });
});

describe("readSettingsSearchAnchor", () => {
  it("reads the anchor a search result put in the location state", () => {
    expect(
      readSettingsSearchAnchor({ [SETTINGS_SEARCH_ANCHOR_STATE_KEY]: "Theme" }),
    ).toBe("Theme");
  });

  it("ignores location state that belongs to something else", () => {
    expect(readSettingsSearchAnchor(null)).toBeNull();
    expect(readSettingsSearchAnchor({ focusPrompt: true })).toBeNull();
    expect(
      readSettingsSearchAnchor({ [SETTINGS_SEARCH_ANCHOR_STATE_KEY]: 4 }),
    ).toBeNull();
  });
});
