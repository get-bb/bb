import { useMemo } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useHostDaemon, useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import type { LocalHostDaemonAccessState } from "@/lib/local-host-daemon-access";
import { usePluginSlots, type PluginFileOpenerSlot } from "@/lib/plugin-slots";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROJECT_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
} from "@/lib/route-paths";
import {
  isSettingsSectionId,
  SETTINGS_NAV_SECTIONS,
  type SettingsNavSection,
  type SettingsSectionId,
} from "./settings-sections";
import {
  buildPluginSettingsEntries,
  type PluginSettingsEntry,
} from "./plugin-settings-entries";

export interface SettingsNavState {
  activeSection: SettingsSectionId | null;
  hasUnknownSection: boolean;
  activePluginId: string | null;
  pluginEntries: readonly PluginSettingsEntry[];
  sections: readonly SettingsNavSection[];
}

export function filterSettingsNavSections({
  hasDaemon,
  accessState,
  fileOpenerCount,
}: {
  hasDaemon: boolean;
  accessState: LocalHostDaemonAccessState;
  fileOpenerCount: number;
}): readonly SettingsNavSection[] {
  return SETTINGS_NAV_SECTIONS.filter(
    (section) =>
      section.id !== "files" ||
      hasDaemon ||
      accessState !== "unavailable" ||
      fileOpenerCount > 0,
  );
}

export function resolveSettingsRoute({
  pathname,
  search,
}: {
  pathname: string;
  search: string;
}): Pick<
  SettingsNavState,
  "activePluginId" | "activeSection" | "hasUnknownSection"
> {
  const sectionMatch = matchPath(SETTINGS_SECTION_ROUTE_PATH, pathname);
  const pluginMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, pathname);
  const isInstalledDetail =
    new URLSearchParams(search).get("view") === "installed";
  const activePluginId = isInstalledDetail
    ? null
    : (pluginMatch?.params.pluginId ?? null);
  const machineMatch = matchPath(SETTINGS_MACHINE_ROUTE_PATH, pathname);
  const activeMachineId = machineMatch?.params.hostId ?? null;
  const projectMatch = matchPath(SETTINGS_PROJECT_ROUTE_PATH, pathname);
  const activeProjectId = projectMatch?.params.projectId ?? null;
  const sectionParam = sectionMatch?.params.section;
  const hasUnknownSection =
    sectionParam !== undefined && !isSettingsSectionId(sectionParam);
  const activeSection: SettingsSectionId | null =
    isInstalledDetail && pluginMatch !== null
      ? "plugins"
      : activeMachineId !== null
        ? "machines"
        : activeProjectId !== null
          ? "projects"
          : activePluginId !== null
            ? null
            : sectionParam !== undefined && isSettingsSectionId(sectionParam)
              ? sectionParam
              : "general";
  return { activePluginId, activeSection, hasUnknownSection };
}

export function useSettingsNavSections(
  fileOpeners: readonly PluginFileOpenerSlot[],
): readonly SettingsNavSection[] {
  const { hasDaemon } = useHostDaemon();
  const { accessState } = useLocalHostDaemonAccess();

  return useMemo(
    () =>
      filterSettingsNavSections({
        hasDaemon,
        accessState,
        fileOpenerCount: fileOpeners.length,
      }),
    [accessState, fileOpeners.length, hasDaemon],
  );
}

export function useSettingsNavState(): SettingsNavState {
  const location = useLocation();
  const { fileOpeners, settingsSections } = usePluginSlots();
  const sections = useSettingsNavSections(fileOpeners);
  const pluginListQuery = usePluginList({ enabled: true });

  const { activePluginId, activeSection, hasUnknownSection } =
    resolveSettingsRoute(location);

  const installedPlugins = pluginListQuery.data?.plugins ?? [];
  const pluginEntries = buildPluginSettingsEntries({
    installedPlugins,
    settingsSections,
  });

  return {
    activePluginId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    sections,
  };
}
