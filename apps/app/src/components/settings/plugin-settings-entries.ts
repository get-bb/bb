import type { InstalledPlugin } from "@bb/server-contract";
import {
  arePluginSettingsAvailable,
  pluginHasSettingsSections,
} from "@/lib/plugin-settings-availability";

export interface PluginSettingsCandidate {
  app: InstalledPlugin["app"];
  enabled: boolean;
  hasSettings: boolean;
  icon: string | null;
  id: string;
  name: string | null;
  status: InstalledPlugin["status"];
}

interface PluginSettingsSectionOwner {
  pluginId: string;
}

export interface PluginSettingsEntry {
  hasSettingsForm: boolean;
  icon: string | null;
  id: string;
  label: string;
}

interface BuildPluginSettingsEntriesArgs {
  installedPlugins: readonly PluginSettingsCandidate[];
  settingsSections: readonly PluginSettingsSectionOwner[];
}

export function buildPluginSettingsEntries(
  args: BuildPluginSettingsEntriesArgs,
): readonly PluginSettingsEntry[] {
  return args.installedPlugins
    .filter(
      (plugin) =>
        plugin.enabled &&
        (plugin.hasSettings ||
          pluginHasSettingsSections(plugin, args.settingsSections)),
    )
    .map((plugin) => ({
      hasSettingsForm: plugin.hasSettings && arePluginSettingsAvailable(plugin),
      id: plugin.id,
      label: plugin.name ?? plugin.id,
      icon: plugin.icon,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
