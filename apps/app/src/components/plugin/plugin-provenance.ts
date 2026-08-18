import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

/** Type-filter id for a plugin the user added from a source themselves. */
const USER_FILTER_ID = "user";

/**
 * Single source of truth for the Type filter: the facet ids, the installed
 * list's filtering, and its publisher-first sort all read one plugin field,
 * `publisherLabel`, so a user filtering to a marketplace never sees rows
 * badged with another.
 *
 * The server decides that label — `BB Official` for bundled plugins, the
 * listing marketplace's display name for catalog installs, null for a plugin
 * the user installed from a source. The filter therefore grows a facet
 * whenever a marketplace is added, with no list to update here.
 *
 * Ids are prefixed rather than being the label itself so a marketplace that
 * calls itself "User" does not collide with the User facet.
 */
export function pluginPublisherFilterId(plugin: PluginListItem): string {
  return plugin.publisherLabel === null
    ? USER_FILTER_ID
    : `publisher:${plugin.publisherLabel}`;
}

/**
 * Filter facets for the plugins on screen: every publisher that actually
 * installed one, then User. Publishers sort by name so the menu order does
 * not follow install order.
 */
export function pluginPublisherFilterOptions(
  plugins: readonly PluginListItem[],
): { id: string; label: string }[] {
  const publishers = new Set<string>();
  let hasUserPlugin = false;
  for (const plugin of plugins) {
    if (plugin.publisherLabel === null) hasUserPlugin = true;
    else publishers.add(plugin.publisherLabel);
  }
  const options = [...publishers]
    .sort((left, right) => left.localeCompare(right))
    .map((label) => ({ id: `publisher:${label}`, label }));
  if (hasUserPlugin) options.push({ id: USER_FILTER_ID, label: "User" });
  return options;
}
