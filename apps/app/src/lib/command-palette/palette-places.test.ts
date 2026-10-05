import { describe, expect, it, vi } from "vitest";
import { SETTINGS_NAV_SECTIONS } from "@/components/settings/settings-sections";
import { buildPalettePlaces, matchPalettePlaces } from "./palette-places";

function build() {
  return buildPalettePlaces({
    navigate: vi.fn(),
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
