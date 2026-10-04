import { matchPath } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import {
  isSettingsSectionId,
  type SettingsNavSection,
} from "@/components/settings/settings-sections";
import type { PluginSettingsEntry } from "@/components/settings/plugin-settings-entries";
import {
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS,
  DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER,
  getPluginNavPanelKey,
} from "@/components/plugin/pluginNavSidebarOrder";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
  isPluginsRoutePath,
  isSkillsRoutePath,
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROJECT_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import { arrangeByStoredOrder } from "@/lib/stored-order";
import type { PaletteAction } from "./palette-action";
import { buildSettingsPaletteActions } from "./palette-settings-actions";
import { buildToolsPagePaletteActions } from "./palette-tools-page-actions";
import type { PaletteVisit } from "./palette-visits";

export type PalettePlaceKind =
  | "page"
  | "setting"
  | "project"
  | "section"
  | "pinned";

export type PaletteScopeKind = "project" | "section" | "pinned";

export interface PaletteScope {
  kind: PaletteScopeKind;
  id: string;
  name: string;
  icon: IconName;
}

export interface PalettePlaceSplit {
  content: PaneContent;
  route: string;
}

export interface PalettePlace {
  id: string;
  kind: PalettePlaceKind;
  title: string;
  icon: IconName;
  split: PalettePlaceSplit | null;
  scope: PaletteScope | null;
  run: () => void;
}

export interface PalettePlaceVisit {
  kind: "page" | "setting";
  id: string;
}

interface PluginPanelIdentity {
  pluginId: string;
  id: string;
  path: string;
}

interface PluginPagePanel extends PluginPanelIdentity {
  title: string;
  icon: string;
}

export const RECENT_PLACES_LIMIT = 3;
export const PLACE_KIND_LABELS: Record<PalettePlaceKind, string> = {
  page: "Page",
  setting: "Setting",
  project: "Project",
  section: "Section",
  pinned: "Pinned",
};

export const PINNED_SCOPE_ID = "pinned";

const TOOLS_PAGE_ICONS: Record<string, IconName> = {
  "tools:plugins": "Plug02",
  "tools:skills": "Zap",
};
const PLUGIN_PAGE_ID_PREFIX = "plugin-page:";
const SETTINGS_TITLE_SUFFIX = " settings";

function pluginPagePlaceId(panel: { pluginId: string; id: string }): string {
  return `${PLUGIN_PAGE_ID_PREFIX}${panel.pluginId}/${panel.id}`;
}

function sidebarPanelKey(panel: { pluginId: string; id: string }): string {
  return panel.pluginId === AUTOMATIONS_PLUGIN_ID
    ? BUILT_IN_SIDEBAR_NAVIGATION_KEYS.automations
    : getPluginNavPanelKey(panel);
}

export function orderPanelsBySidebar<TPanel extends PluginPanelIdentity>(
  panels: readonly TPanel[],
  storedOrder: readonly string[],
): TPanel[] {
  return arrangeByStoredOrder({
    items: panels,
    getId: sidebarPanelKey,
    storedOrder: [...storedOrder, ...DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER],
  }).ordered;
}

function settingPlace(action: PaletteAction, icon: IconName): PalettePlace {
  return {
    id: action.id,
    kind: "setting",
    title: action.title.endsWith(SETTINGS_TITLE_SUFFIX)
      ? action.title.slice(0, -SETTINGS_TITLE_SUFFIX.length)
      : action.title,
    icon,
    split: null,
    scope: null,
    run: action.run,
  };
}

interface BuildPalettePlacesArgs {
  navigate: (path: string) => void;
  panels: readonly PluginPagePanel[];
  pluginSettingsEntries: readonly PluginSettingsEntry[];
  settingsSections: readonly SettingsNavSection[];
}

export function buildPalettePlaces({
  navigate,
  panels,
  pluginSettingsEntries,
  settingsSections,
}: BuildPalettePlacesArgs): PalettePlace[] {
  const pages = panels.map((panel): PalettePlace => {
    const route = getPluginPanelRoutePath({
      pluginId: panel.pluginId,
      path: panel.path,
    });
    return {
      id: pluginPagePlaceId(panel),
      kind: "page",
      title: panel.title,
      icon: panel.icon,
      split: {
        content: {
          kind: "plugin-panel",
          pluginId: panel.pluginId,
          panelPath: panel.path,
          subPath: "",
        },
        route,
      },
      scope: null,
      run: () => navigate(route),
    };
  });
  const tools = buildToolsPagePaletteActions({ navigate }).map(
    (action): PalettePlace => ({
      id: action.id,
      kind: "page",
      title: action.title,
      icon: TOOLS_PAGE_ICONS[action.id] ?? "Plug02",
      split: null,
      scope: null,
      run: action.run,
    }),
  );
  const sections = settingsSections.flatMap((section) =>
    buildSettingsPaletteActions({
      navigate,
      pluginEntries: [],
      sections: [section],
    }).map((action) => settingPlace(action, section.icon)),
  );
  const pluginSettings = pluginSettingsEntries.flatMap((entry) =>
    buildSettingsPaletteActions({
      navigate,
      pluginEntries: [entry],
      sections: [],
    }).map((action) => settingPlace(action, entry.icon ?? "Plug02")),
  );
  return [...pages, ...tools, ...sections, ...pluginSettings];
}

export function resolvePalettePlaceVisit(
  pathname: string,
  panels: readonly PluginPanelIdentity[],
): PalettePlaceVisit | null {
  let page: { id: string; length: number } | null = null;
  for (const panel of panels) {
    const root = getPluginPanelRoutePath({
      pluginId: panel.pluginId,
      path: panel.path,
    });
    const matches = pathname === root || pathname.startsWith(`${root}/`);
    if (matches && (page === null || root.length > page.length)) {
      page = { id: pluginPagePlaceId(panel), length: root.length };
    }
  }
  if (page !== null) return { kind: "page", id: page.id };
  if (isPluginsRoutePath(pathname)) return { kind: "page", id: "tools:plugins" };
  if (isSkillsRoutePath(pathname)) return { kind: "page", id: "tools:skills" };
  if (pathname === SETTINGS_ROUTE_PATH) {
    return { kind: "setting", id: "settings:general" };
  }
  const pluginId = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, pathname)?.params
    .pluginId;
  if (pluginId !== undefined && pluginId.length > 0) {
    return { kind: "setting", id: `settings:plugin:${pluginId}` };
  }
  if (matchPath(SETTINGS_PROJECT_ROUTE_PATH, pathname) !== null) {
    return { kind: "setting", id: "settings:projects" };
  }
  if (matchPath(SETTINGS_MACHINE_ROUTE_PATH, pathname) !== null) {
    return { kind: "setting", id: "settings:machines" };
  }
  const section = matchPath(SETTINGS_SECTION_ROUTE_PATH, pathname)?.params
    .section;
  if (section !== undefined && isSettingsSectionId(section)) {
    return { kind: "setting", id: `settings:${section}` };
  }
  return null;
}

interface SelectRecentPlacesArgs {
  currentPlaceId: string | null;
  places: readonly PalettePlace[];
  visits: readonly PaletteVisit[];
}

export function selectRecentPlaces({
  currentPlaceId,
  places,
  visits,
}: SelectRecentPlacesArgs): PalettePlace[] {
  const placesById = new Map(places.map((place) => [place.id, place]));
  const visited = visits.flatMap((visit) => {
    const place = placesById.get(visit.id);
    return place !== undefined &&
      place.kind === visit.kind &&
      place.id !== currentPlaceId
      ? [place]
      : [];
  });
  if (visited.length > 0) return visited.slice(0, RECENT_PLACES_LIMIT);
  return places
    .filter(
      (place) =>
        place.id.startsWith(PLUGIN_PAGE_ID_PREFIX) &&
        place.id !== currentPlaceId,
    )
    .slice(0, RECENT_PLACES_LIMIT);
}

interface PaletteGroupingSource {
  id: string;
  name: string;
}

interface BuildPaletteGroupingPlacesArgs {
  projects: readonly PaletteGroupingSource[];
  personalProject: PaletteGroupingSource | null;
  sections: readonly PaletteGroupingSource[];
  hasPinnedThreads: boolean;
}

function scopePlace(scope: PaletteScope): PalettePlace {
  return {
    id: scope.id,
    kind: scope.kind,
    title: scope.name,
    icon: scope.icon,
    split: null,
    scope,
    run: () => {},
  };
}

export function buildPaletteGroupingPlaces({
  projects,
  personalProject,
  sections,
  hasPinnedThreads,
}: BuildPaletteGroupingPlacesArgs): PalettePlace[] {
  return [
    ...projects.map((project) =>
      scopePlace({ kind: "project", id: project.id, name: project.name, icon: "Folder" }),
    ),
    ...(personalProject === null
      ? []
      : [
          scopePlace({
            kind: "project",
            id: personalProject.id,
            name: "Personal",
            icon: "Folder",
          }),
        ]),
    ...sections.map((section) =>
      scopePlace({ kind: "section", id: section.id, name: section.name, icon: "Layers" }),
    ),
    ...(hasPinnedThreads
      ? [scopePlace({ kind: "pinned", id: PINNED_SCOPE_ID, name: "Pinned", icon: "Pin" })]
      : []),
  ];
}
