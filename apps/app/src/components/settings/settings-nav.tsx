import { matchPath, useLocation } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { usePreferredTheme } from "@/hooks/useTheme";
import { usePluginLogoUrl } from "@/lib/plugin-logos";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
} from "@/lib/route-paths";

/**
 * The settings buckets: shared between the settings sidebar (which replaces
 * the app sidebar on /settings routes) and SettingsView (which renders the
 * selected bucket's content).
 */
export const SETTINGS_NAV_SECTIONS = [
  { icon: "Settings", id: "general", label: "General" },
  { icon: "Palette", id: "appearance", label: "Appearance" },
  { icon: "ChartColumn", id: "usage", label: "Usage limits" },
  { icon: "Folder", id: "files", label: "Files" },
  { icon: "Zap", id: "experiments", label: "Experiments" },
  { icon: "Layers", id: "plugins", label: "Plugins" },
  { icon: "MessageSquare", id: "community", label: "Community" },
] as const satisfies readonly {
  icon: IconName;
  id: string;
  label: string;
}[];

export type SettingsNavSection = (typeof SETTINGS_NAV_SECTIONS)[number];

export type SettingsSectionId = SettingsNavSection["id"];

export function isSettingsSectionId(
  value: string,
): value is SettingsSectionId {
  return SETTINGS_NAV_SECTIONS.some((section) => section.id === value);
}

export interface SettingsNavState {
  /** Plugin id from /settings/plugins/:pluginId, else null. */
  activePluginId: string | null;
  /** Selected bucket; null while a plugin page is active. */
  activeSection: SettingsSectionId | null;
  /** True when the :section URL segment is unknown (the view redirects). */
  hasUnknownSection: boolean;
  /** Enabled plugins that declared settings or settingsSection slots. */
  pluginEntries: PluginListItem[];
  /** Buckets visible on this host (files/plugins hide when irrelevant). */
  sections: readonly SettingsNavSection[];
}

/**
 * URL → settings navigation state. Uses matchPath on the location (not
 * useParams) so it works both inside the settings route element and in the
 * sidebar, which mounts outside the route tree.
 */
export function useSettingsNavState(): SettingsNavState {
  const location = useLocation();
  const { hasDaemon } = useHostDaemon();
  const { fileOpeners, settingsSections } = usePluginSlots();
  const systemConfig = useSystemConfig();
  const pluginsEnabled = systemConfig.data?.experiments.plugins === true;
  const settingsSectionPluginIds = new Set(
    settingsSections.map((section) => section.pluginId),
  );
  const pluginListQuery = usePluginList({
    enabled: pluginsEnabled || settingsSectionPluginIds.size > 0,
  });

  const pluginMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, location.pathname);
  const sectionMatch = matchPath(
    SETTINGS_SECTION_ROUTE_PATH,
    location.pathname,
  );
  const activePluginId = pluginMatch?.params.pluginId ?? null;
  const sectionParam =
    activePluginId === null ? sectionMatch?.params.section : undefined;
  const hasUnknownSection =
    sectionParam !== undefined && !isSettingsSectionId(sectionParam);
  const activeSection: SettingsSectionId | null =
    activePluginId !== null
      ? null
      : sectionParam !== undefined && isSettingsSectionId(sectionParam)
        ? sectionParam
        : "general";

  const sections = SETTINGS_NAV_SECTIONS.filter((section) => {
    if (section.id === "files") {
      return hasDaemon || fileOpeners.length > 0;
    }
    if (section.id === "plugins") {
      return pluginsEnabled;
    }
    return true;
  });
  const pluginEntries = (pluginListQuery.data ?? []).filter(
    (plugin) =>
      plugin.enabled &&
      (plugin.hasSettings || settingsSectionPluginIds.has(plugin.id)),
  );

  return {
    activePluginId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    sections,
  };
}

export function PluginNavIcon({ plugin }: { plugin: PluginListItem }) {
  const theme = usePreferredTheme();
  const storedLogoUrl = usePluginLogoUrl(plugin.id);
  const logoUrl =
    theme === "dark" && plugin.logoDarkUrl !== null
      ? plugin.logoDarkUrl
      : (plugin.logoUrl ?? storedLogoUrl);
  if (logoUrl === null) {
    return <Icon name="Layers" className="size-4 shrink-0" />;
  }
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 rounded-sm object-contain"
    />
  );
}
