import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { IconName } from "@bb/shared-ui/icon";
import type { SettingsNavSection } from "@/components/settings/settings-sections";
import type { PluginSettingsEntry } from "@/components/settings/plugin-settings-entries";
import { TOOLS_SECTIONS } from "@/components/tools/tools-navigation";
import { getPluginPanelRoutePath } from "@/lib/route-paths";
import { buildSettingsPaletteActions } from "./palette-settings-actions";
import {
  positionsToRanges,
  type HighlightRange,
} from "./palette-thread-search";

export type PalettePlaceKind = "page" | "setting";

export interface PalettePlace {
  id: string;
  kind: PalettePlaceKind;
  title: string;
  icon: IconName;
  run: () => void;
}

export interface PalettePlaceMatch {
  place: PalettePlace;
  highlightRanges: readonly HighlightRange[];
}

export const PALETTE_PLACE_KIND_LABELS: Record<PalettePlaceKind, string> = {
  page: "Page",
  setting: "Setting",
};

const SETTINGS_TITLE_SUFFIX = " settings";
const PLUGIN_ICON: IconName = "Plug02";

interface BuildPalettePlacesArgs {
  navigate: (path: string) => void;
  panels: readonly {
    pluginId: string;
    id: string;
    path: string;
    title: string;
    icon: string;
  }[];
  pluginSettingsEntries: readonly PluginSettingsEntry[];
  settingsSections: readonly SettingsNavSection[];
}

export function buildPalettePlaces({
  navigate,
  panels,
  pluginSettingsEntries,
  settingsSections,
}: BuildPalettePlacesArgs): PalettePlace[] {
  const pages = panels.map((panel): PalettePlace => ({
    id: `plugin-page:${panel.pluginId}/${panel.id}`,
    kind: "page",
    title: panel.title,
    icon: panel.icon,
    run: () =>
      navigate(
        getPluginPanelRoutePath({ pluginId: panel.pluginId, path: panel.path }),
      ),
  }));
  const tools = [TOOLS_SECTIONS.plugins, TOOLS_SECTIONS.skills].map(
    (section): PalettePlace => ({
      id: `tools:${section.id}`,
      kind: "page",
      title: section.label,
      icon: section.id === "plugins" ? PLUGIN_ICON : "Zap",
      run: () => navigate(section.to),
    }),
  );
  const settingIcons = [
    ...settingsSections.map((section) => section.icon),
    ...pluginSettingsEntries.map((entry) => entry.icon ?? PLUGIN_ICON),
  ];
  const settings = buildSettingsPaletteActions({
    navigate,
    pluginEntries: pluginSettingsEntries,
    sections: settingsSections,
  }).map((action, index): PalettePlace => ({
    id: action.id,
    kind: "setting",
    title: action.title.endsWith(SETTINGS_TITLE_SUFFIX)
      ? action.title.slice(0, -SETTINGS_TITLE_SUFFIX.length)
      : action.title,
    icon: settingIcons[index] ?? PLUGIN_ICON,
    run: action.run,
  }));
  return [...pages, ...tools, ...settings];
}

export function matchPalettePlaces(
  places: readonly PalettePlace[],
  query: string,
): PalettePlaceMatch[] {
  if (query.trim().length === 0) return [];
  return fuzzyMatchText({
    items: places,
    query,
    getText: (place) => place.title,
    limit: places.length,
  })
    .sort((left, right) => right.score - left.score)
    .map((match) => ({
      place: match.item,
      highlightRanges: positionsToRanges(match.positions),
    }));
}
