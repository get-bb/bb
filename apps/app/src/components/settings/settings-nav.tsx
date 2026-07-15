import { matchPath, useLocation } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROVIDER_ROUTE_PATH,
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
  { icon: "SlidersHorizontal", id: "keyboard", label: "Keyboard" },
  { icon: "ChartColumn", id: "usage", label: "Usage limits" },
  { icon: "Folder", id: "files", label: "Files" },
  { icon: "Laptop", id: "machines", label: "Machines" },
  { icon: "Beaker", id: "experiments", label: "Experiments" },
  { icon: "Layers", id: "plugins", label: "Plugins" },
  { icon: "MessageSquare", id: "community", label: "Community" },
  { icon: "Archive", id: "archived", label: "Archived threads" },
] as const satisfies readonly {
  icon: IconName;
  id: string;
  label: string;
}[];

export type SettingsNavSection = (typeof SETTINGS_NAV_SECTIONS)[number];

export type SettingsSectionId = SettingsNavSection["id"];

export const SETTINGS_PROVIDER_ENTRIES = [
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
] as const;
export type SettingsProviderId =
  (typeof SETTINGS_PROVIDER_ENTRIES)[number]["id"];

function isSettingsProviderId(value: string): value is SettingsProviderId {
  return SETTINGS_PROVIDER_ENTRIES.some((provider) => provider.id === value);
}

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_NAV_SECTIONS.some((section) => section.id === value);
}

export interface SettingsNavState {
  /** Plugin id from /settings/plugins/:pluginId, else null. */
  activePluginId: string | null;
  /** Provider id from /settings/providers/:providerId, else null. */
  activeProviderId: SettingsProviderId | null;
  /** Selected bucket; null while a plugin page is active. */
  activeSection: SettingsSectionId | null;
  /** True when the :section URL segment is unknown (the view redirects). */
  hasUnknownSection: boolean;
  /** Enabled plugins that declared settings or settingsSection slots. */
  pluginEntries: PluginListItem[];
  providerEntries: typeof SETTINGS_PROVIDER_ENTRIES;
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
  const providerMatch = matchPath(
    SETTINGS_PROVIDER_ROUTE_PATH,
    location.pathname,
  );
  const sectionMatch = matchPath(
    SETTINGS_SECTION_ROUTE_PATH,
    location.pathname,
  );
  const activePluginId = pluginMatch?.params.pluginId ?? null;
  const providerParam = providerMatch?.params.providerId;
  const activeProviderId =
    providerParam !== undefined && isSettingsProviderId(providerParam)
      ? providerParam
      : null;
  const sectionParam =
    activePluginId === null && providerMatch === null
      ? sectionMatch?.params.section
      : undefined;
  const hasUnknownSection =
    (sectionParam !== undefined && !isSettingsSectionId(sectionParam)) ||
    (providerParam !== undefined && !isSettingsProviderId(providerParam));
  const activeSection: SettingsSectionId | null =
    activePluginId !== null || providerMatch !== null
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
  const pluginEntries = (pluginListQuery.data?.plugins ?? []).filter(
    (plugin) =>
      plugin.enabled &&
      (plugin.hasSettings || settingsSectionPluginIds.has(plugin.id)),
  );

  return {
    activePluginId,
    activeProviderId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    providerEntries: SETTINGS_PROVIDER_ENTRIES,
    sections,
  };
}

export function PluginNavIcon({ plugin }: { plugin: PluginListItem }) {
  return <PluginIcon pluginId={plugin.id} icon={plugin.icon ?? "Layers"} />;
}
