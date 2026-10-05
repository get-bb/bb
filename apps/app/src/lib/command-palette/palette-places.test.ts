import { describe, expect, it, vi } from "vitest";
import { SETTINGS_NAV_SECTIONS } from "@/components/settings/settings-sections";
import {
  buildPaletteGroupingPlaces,
  buildPalettePlaces,
  isThreadInGrouping,
  matchPalettePlaces,
} from "./palette-places";

function build(navigate = vi.fn()) {
  return buildPalettePlaces({
    navigate,
    panels: [
      {
        pluginId: "automations",
        id: "main",
        path: "automations",
        title: "Automations",
        icon: "Clock",
      },
    ],
    pluginSettingsEntries: [{ id: "linear", label: "Linear", icon: null }],
    settingsSections: SETTINGS_NAV_SECTIONS.filter(
      (section) => section.id === "keyboard",
    ),
  });
}

describe("buildPalettePlaces", () => {
  it("lists plugin pages, tools pages, and settings without the settings suffix", () => {
    expect(
      build().map(({ id, kind, title, icon }) => ({ id, kind, title, icon })),
    ).toEqual([
      {
        id: "plugin-page:automations/main",
        kind: "page",
        title: "Automations",
        icon: "Clock",
      },
      { id: "tools:plugins", kind: "page", title: "Plugins", icon: "Plug02" },
      { id: "tools:skills", kind: "page", title: "Skills", icon: "Zap" },
      {
        id: "settings:keyboard",
        kind: "setting",
        title: "Keyboard",
        icon: "SlidersHorizontal",
      },
      {
        id: "settings:plugin:linear",
        kind: "setting",
        title: "Linear",
        icon: "Plug02",
      },
    ]);
  });

  it("navigates once to the place's route", () => {
    const navigate = vi.fn();
    const places = build(navigate);
    places.find((place) => place.id === "settings:plugin:linear")?.run();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/settings/plugins/linear");
  });
});

describe("matchPalettePlaces", () => {
  it("ranks matching titles and lists nothing before typing", () => {
    const places = build();
    expect(matchPalettePlaces(places, " ")).toEqual([]);
    const [first] = matchPalettePlaces(places, "autom");
    expect(first?.place.title).toBe("Automations");
    expect(first?.highlightRanges).toEqual([{ start: 0, end: 5 }]);
    expect(
      matchPalettePlaces(places, "keyb").map((match) => match.place.id),
    ).toEqual(["settings:keyboard"]);
  });
});

describe("buildPaletteGroupingPlaces", () => {
  const args = {
    projects: [{ id: "project-1", name: "Web" }],
    personalProject: { id: "proj_personal", name: "My threads" },
    sections: [{ id: "sec-1", name: "Launch" }],
  };

  it("lists projects, Personal, sections, and Pinned only when something is pinned", () => {
    const places = buildPaletteGroupingPlaces({
      ...args,
      hasPinnedThreads: true,
    });
    expect(
      places.map(({ id, kind, title, icon }) => ({ id, kind, title, icon })),
    ).toEqual([
      {
        id: "project:project-1",
        kind: "project",
        title: "Web",
        icon: "Folder",
      },
      {
        id: "project:proj_personal",
        kind: "project",
        title: "Personal",
        icon: "Folder",
      },
      { id: "section:sec-1", kind: "section", title: "Launch", icon: "Layers" },
      { id: "pinned:pinned", kind: "pinned", title: "Pinned", icon: "Pin" },
    ]);
    expect(
      buildPaletteGroupingPlaces({ ...args, hasPinnedThreads: false }).map(
        (place) => place.kind,
      ),
    ).not.toContain("pinned");
  });

  it("matches threads by project, section, and pin", () => {
    const thread = {
      projectId: "project-1",
      sectionId: "sec-1",
      pinnedAt: null,
    };
    const [project, , section, pinned] = buildPaletteGroupingPlaces({
      ...args,
      hasPinnedThreads: true,
    }).map((place) => place.grouping);
    expect(project && isThreadInGrouping(thread, project)).toBe(true);
    expect(section && isThreadInGrouping(thread, section)).toBe(true);
    expect(pinned && isThreadInGrouping(thread, pinned)).toBe(false);
    expect(
      pinned && isThreadInGrouping({ ...thread, pinnedAt: 1 }, pinned),
    ).toBe(true);
  });
});
