import { getPluginConfigurationRoutePath } from "@/lib/route-paths";

export interface PluginSettingsCandidate {
  hasSettings: boolean;
  icon: string | null;
  id: string;
  name: string | null;
}

interface PluginSettingsSectionOwner {
  pluginId: string;
}

export interface PluginSettingsEntry {
  hasConfiguration: boolean;
  icon: string | null;
  id: string;
  label: string;
}

export function getPluginSettingsEntryRoutePath(
  entry: PluginSettingsEntry,
): string {
  const path = getPluginConfigurationRoutePath({ pluginId: entry.id });
  return `${path}?view=installed`;
}

interface BuildPluginSettingsEntriesArgs {
  installedPlugins: readonly PluginSettingsCandidate[];
  settingsSections: readonly PluginSettingsSectionOwner[];
}

export function buildPluginSettingsEntries(
  args: BuildPluginSettingsEntriesArgs,
): readonly PluginSettingsEntry[] {
  const pluginsWithCustomSettings = new Set(
    args.settingsSections.map((section) => section.pluginId),
  );
  return args.installedPlugins
    .map((plugin) => ({
      hasConfiguration:
        plugin.hasSettings || pluginsWithCustomSettings.has(plugin.id),
      id: plugin.id,
      label: plugin.name ?? plugin.id,
      icon: plugin.icon,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
