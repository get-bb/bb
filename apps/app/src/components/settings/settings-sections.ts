import type { IconName } from "@bb/shared-ui/icon";
import type { ExperimentalSettingsSection } from "@get-bb/plugin-sdk";
import { SETTINGS_ROUTE_PATH } from "@/lib/route-paths";

export const SETTINGS_NAV_SECTIONS = [
  { icon: "Settings", id: "general", label: "General" },
  { icon: "Bot", id: "providers", label: "Providers" },
  { icon: "AiBrain01", id: "ai-services", label: "AI services" },
  { icon: "Palette", id: "appearance", label: "Appearance" },
  { icon: "SlidersHorizontal", id: "keyboard", label: "Keyboard" },
  { icon: "Browser", id: "browser", label: "Browser" },
  { icon: "File", id: "files", label: "Files" },
  { icon: "FolderGit", id: "projects", label: "Projects" },
  { icon: "Laptop", id: "machines", label: "Machines" },
  { icon: "Smartphone", id: "mobile", label: "Mobile" },
  {
    icon: "Lock",
    id: "environment-variables",
    label: "Environment variables",
  },
  { icon: "PackageReceive", id: "updates", label: "Updates" },
  { icon: "Plug02", id: "plugins", label: "Installed plugins" },
  { icon: "Puzzle", id: "marketplaces", label: "Plugin marketplaces" },
  { icon: "Beaker", id: "experiments", label: "Experiments" },
  { icon: "MessageSquare", id: "community", label: "Community" },
  { icon: "Archive", id: "archived", label: "Archived threads" },
] as const satisfies readonly {
  icon: IconName;
  id: ExperimentalSettingsSection;
  label: string;
}[];

export type SettingsNavSection = (typeof SETTINGS_NAV_SECTIONS)[number];

export type SettingsSectionId = SettingsNavSection["id"];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_NAV_SECTIONS.some((section) => section.id === value);
}

export type SettingsTarget =
  | { section: SettingsSectionId }
  | { pluginId: string }
  | { machineId: string }
  | { projectId: string };

export function getSettingsTargetPath(target: SettingsTarget): string {
  if ("section" in target) {
    return target.section === "general"
      ? SETTINGS_ROUTE_PATH
      : `${SETTINGS_ROUTE_PATH}/${encodeURIComponent(target.section)}`;
  }
  if ("pluginId" in target) {
    return `${SETTINGS_ROUTE_PATH}/plugins/${encodeURIComponent(target.pluginId)}`;
  }
  if ("machineId" in target) {
    return `${SETTINGS_ROUTE_PATH}/machines/${encodeURIComponent(target.machineId)}`;
  }
  return `${SETTINGS_ROUTE_PATH}/projects/${encodeURIComponent(target.projectId)}`;
}
