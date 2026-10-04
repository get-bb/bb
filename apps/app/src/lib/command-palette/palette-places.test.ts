import { describe, expect, it, vi } from "vitest";
import {
  getSettingsSectionRoutePath,
  SETTINGS_NAV_SECTIONS,
} from "@/components/settings/settings-sections";
import {
  buildPalettePlaces,
  resolvePalettePlaceVisit,
  selectRecentPlaces,
  type PalettePlace,
} from "./palette-places";
import type { PaletteVisit } from "./palette-visits";

const panels = [
  { pluginId: "automations", id: "main", path: "automations", title: "Automations", icon: "Repeat" },
  { pluginId: "docs", id: "main", path: "docs", title: "Docs", icon: "Book" },
  { pluginId: "docs", id: "api", path: "docs-api", title: "API docs", icon: "Book" },
  { pluginId: "wiki", id: "main", path: "wiki", title: "Wiki", icon: "Book" },
];

function place(id: string, kind: PalettePlace["kind"] = "page"): PalettePlace {
  return { id, kind, title: id, icon: "Zap", split: null, run: () => {} };
}

function visit(kind: PaletteVisit["kind"], id: string, visitedAt: number): PaletteVisit {
  return { kind, id, visitedAt };
}

describe("resolvePalettePlaceVisit", () => {
  it.each([
    ["/plugins/automations/automations", "page", "plugin-page:automations/main"],
    ["/plugins/automations/automations/runs/abc", "page", "plugin-page:automations/main"],
    ["/plugins/docs/docs-api/reference", "page", "plugin-page:docs/api"],
    ["/plugins", "page", "tools:plugins"],
    ["/skills", "page", "tools:skills"],
    ["/settings", "setting", "settings:general"],
    ["/settings/keyboard", "setting", "settings:keyboard"],
    ["/settings/machines/host_1", "setting", "settings:machines"],
    ["/settings/projects/proj_1", "setting", "settings:projects"],
    ["/settings/plugins/linear", "setting", "settings:plugin:linear"],
  ])("maps %s to its place", (pathname, kind, id) => {
    expect(resolvePalettePlaceVisit(pathname, panels)).toEqual({ kind, id });
  });

  it.each([
    "/projects/proj_1/threads/thr_1",
    "/",
    "/settings/not-a-section",
  ])("records nothing for %s", (pathname) => {
    expect(resolvePalettePlaceVisit(pathname, panels)).toBeNull();
  });
});

describe("selectRecentPlaces", () => {
  const places = [
    place("plugin-page:automations/main"),
    place("plugin-page:docs/main"),
    place("plugin-page:wiki/main"),
    place("tools:plugins"),
    place("settings:keyboard", "setting"),
  ];

  it("lists visited places newest first, skipping the current place and threads", () => {
    const visits = [
      visit("setting", "settings:keyboard", 50),
      visit("thread", "thr_1", 40),
      visit("page", "plugin-page:automations/main", 30),
      visit("page", "tools:plugins", 20),
      visit("page", "plugin-page:wiki/main", 10),
    ];
    expect(
      selectRecentPlaces({
        currentPlaceId: "settings:keyboard",
        places,
        visits,
      }).map((entry) => entry.id),
    ).toEqual([
      "plugin-page:automations/main",
      "tools:plugins",
      "plugin-page:wiki/main",
    ]);
  });

  it("falls back to the first three plugin pages on a fresh device", () => {
    expect(
      selectRecentPlaces({
        currentPlaceId: "plugin-page:docs/main",
        places,
        visits: [visit("thread", "thr_1", 1)],
      }).map((entry) => entry.id),
    ).toEqual(["plugin-page:automations/main", "plugin-page:wiki/main"]);
  });

  it("ignores visits to places that no longer exist", () => {
    expect(
      selectRecentPlaces({
        currentPlaceId: null,
        places,
        visits: [
          visit("page", "plugin-page:removed/main", 5),
          visit("page", "plugin-page:docs/main", 4),
        ],
      }).map((entry) => entry.id),
    ).toEqual(["plugin-page:docs/main"]);
  });
});

describe("buildPalettePlaces", () => {
  it("drops the settings suffix and navigates once to each place", () => {
    const navigate = vi.fn();
    const places = buildPalettePlaces({
      navigate,
      panels: [panels[1]],
      pluginSettingsEntries: [],
      settingsSections: SETTINGS_NAV_SECTIONS.filter(
        (section) => section.id === "keyboard",
      ),
    });
    const keyboard = places.find((entry) => entry.id === "settings:keyboard");
    expect(keyboard?.title).toBe("Keyboard");
    expect(keyboard?.kind).toBe("setting");
    keyboard?.run();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      getSettingsSectionRoutePath("keyboard"),
    );
    const docs = places.find((entry) => entry.id === "plugin-page:docs/main");
    expect(docs?.split?.content).toEqual({
      kind: "plugin-panel",
      pluginId: "docs",
      panelPath: "docs",
      subPath: "",
    });
    expect(places.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["tools:plugins", "tools:skills"]),
    );
  });
});
