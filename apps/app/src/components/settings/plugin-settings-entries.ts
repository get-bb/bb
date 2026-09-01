export interface PluginSettingsCandidate {
  icon: string | null;
  id: string;
  name: string | null;
}

export interface PluginSettingsEntry {
  icon: string | null;
  id: string;
  label: string;
}

interface BuildPluginSettingsEntriesArgs {
  installedPlugins: readonly PluginSettingsCandidate[];
}

export function buildPluginSettingsEntries(
  args: BuildPluginSettingsEntriesArgs,
): PluginSettingsEntry[] {
  return args.installedPlugins
    .map((plugin) => ({
      id: plugin.id,
      label: plugin.name ?? plugin.id,
      icon: plugin.icon,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
