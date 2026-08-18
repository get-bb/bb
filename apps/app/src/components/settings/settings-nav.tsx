import { matchPath, useLocation } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import { useHostDaemon, useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { usePluginSlots } from "@/lib/plugin-slots";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  SETTINGS_MACHINE_ROUTE_PATH,
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
  { icon: "PackageReceive", id: "updates", label: "Updates" },
  { icon: "Puzzle", id: "marketplaces", label: "Plugin marketplaces" },
  { icon: "Beaker", id: "experiments", label: "Experiments" },
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
  /** Host id from /settings/machines/:hostId, else null. */
  activeMachineId: string | null;
  /** Provider id from /settings/providers/:providerId, else null. */
  activeProviderId: SettingsProviderId | null;
  /** Selected bucket; null while a provider page is active. */
  activeSection: SettingsSectionId | null;
  /** True when the :section URL segment is unknown (the view redirects). */
  hasUnknownSection: boolean;
  /** The plugin whose settings page is open, when on /settings/plugins/:id. */
  activePluginId: string | null;
  /** Enabled plugins with configuration, for the sidebar's Plugins group. */
  pluginEntries: readonly { id: string; label: string; icon: string | null }[];
  providerEntries: typeof SETTINGS_PROVIDER_ENTRIES;
  /** Buckets visible on this host. */
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
  const { accessState } = useLocalHostDaemonAccess();
  const { fileOpeners, settingsSections } = usePluginSlots();
  const pluginListQuery = usePluginList({ enabled: true });

  const providerMatch = matchPath(
    SETTINGS_PROVIDER_ROUTE_PATH,
    location.pathname,
  );
  const sectionMatch = matchPath(
    SETTINGS_SECTION_ROUTE_PATH,
    location.pathname,
  );
  const pluginMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, location.pathname);
  const activePluginId = pluginMatch?.params.pluginId ?? null;
  // A machine page keeps the Machines bucket selected in the sidebar.
  const machineMatch = matchPath(
    SETTINGS_MACHINE_ROUTE_PATH,
    location.pathname,
  );
  const activeMachineId = machineMatch?.params.hostId ?? null;
  const providerParam = providerMatch?.params.providerId;
  const activeProviderId =
    providerParam !== undefined && isSettingsProviderId(providerParam)
      ? providerParam
      : null;
  const sectionParam =
    providerMatch === null ? sectionMatch?.params.section : undefined;
  const hasUnknownSection =
    (sectionParam !== undefined && !isSettingsSectionId(sectionParam)) ||
    (providerParam !== undefined && !isSettingsProviderId(providerParam));
  const activeSection: SettingsSectionId | null =
    activeMachineId !== null
      ? "machines"
      : providerMatch !== null || activePluginId !== null
        ? null
        : sectionParam !== undefined && isSettingsSectionId(sectionParam)
          ? sectionParam
          : "general";

  const sections = SETTINGS_NAV_SECTIONS.filter((section) => {
    if (section.id === "files") {
      return (
        hasDaemon || accessState !== "unavailable" || fileOpeners.length > 0
      );
    }
    return true;
  });
  // A plugin earns a Settings row by actually having configuration: a
  // declarative settings form or a mounted settingsSection slot.
  const pluginEntries = (pluginListQuery.data?.plugins ?? [])
    .filter(
      (plugin) =>
        plugin.enabled &&
        (plugin.hasSettings ||
          settingsSections.some((section) => section.pluginId === plugin.id)),
    )
    .map((plugin) => ({
      id: plugin.id,
      label: plugin.name ?? plugin.id,
      icon: plugin.icon,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return {
    activeMachineId,
    activePluginId,
    activeProviderId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    providerEntries: SETTINGS_PROVIDER_ENTRIES,
    sections,
  };
}
