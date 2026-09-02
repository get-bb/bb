export interface PluginSettingsCandidate {
  enabled: boolean;
  hasSettings: boolean;
  icon: string | null;
  id: string;
  name: string | null;
}

interface PluginSettingsSectionOwner {
  pluginId: string;
}

export interface PluginSettingsEntry {
  icon: string | null;
  id: string;
  label: string;
}

interface BuildPluginSettingsEntriesArgs {
  installedPlugins: readonly PluginSettingsCandidate[];
  settingsSections: readonly PluginSettingsSectionOwner[];
}

export interface PluginSettingsEntryGroups {
  all: readonly PluginSettingsEntry[];
  configurable: readonly PluginSettingsEntry[];
  other: readonly PluginSettingsEntry[];
}

export function buildPluginSettingsEntries(
  args: BuildPluginSettingsEntriesArgs,
): PluginSettingsEntryGroups {
  const pluginsWithCustomSettings = new Set(
    args.settingsSections.map((section) => section.pluginId),
  );
  const categorizedEntries = args.installedPlugins
    .map((plugin) => ({
      entry: {
        id: plugin.id,
        label: plugin.name ?? plugin.id,
        icon: plugin.icon,
      },
      configurable:
        plugin.enabled &&
        (plugin.hasSettings || pluginsWithCustomSettings.has(plugin.id)),
    }))
    .sort((left, right) => left.entry.label.localeCompare(right.entry.label));

  return {
    all: categorizedEntries.map(({ entry }) => entry),
    configurable: categorizedEntries
      .filter(({ configurable }) => configurable)
      .map(({ entry }) => entry),
    other: categorizedEntries
      .filter(({ configurable }) => !configurable)
      .map(({ entry }) => entry),
  };
}
