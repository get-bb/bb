import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

const DIRECT_INSTALL_FILTER_ID = "user";

export function pluginSourceFilterId(plugin: PluginListItem): string {
  return plugin.publisherLabel === null
    ? DIRECT_INSTALL_FILTER_ID
    : `publisher:${plugin.publisherLabel}`;
}

export function pluginSourceFilterOptions(
  plugins: readonly PluginListItem[],
): { id: string; label: string }[] {
  const publishers = new Set<string>();
  let hasDirectInstall = false;
  for (const plugin of plugins) {
    if (plugin.publisherLabel === null) hasDirectInstall = true;
    else publishers.add(plugin.publisherLabel);
  }
  const options = [...publishers]
    .sort((left, right) => left.localeCompare(right))
    .map((label) => ({ id: `publisher:${label}`, label }));
  if (hasDirectInstall)
    options.push({ id: DIRECT_INSTALL_FILTER_ID, label: "Direct install" });
  return options;
}
