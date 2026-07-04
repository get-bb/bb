import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { PluginMentionSearchGroup } from "./queries/plugin-contribution-queries";
import type { PluginListItem } from "./queries/plugin-settings-queries";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";
import { compareCodepoint } from "@/lib/codepoint-compare";

export type InstalledPluginMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "plugin"; itemId?: never }
>;

export interface BuildInstalledPluginMentionSuggestionsArgs {
  plugins: readonly PluginListItem[];
  query: string;
  limit: number;
}

function getInstalledPluginSearchTexts(
  plugin: PluginListItem,
): readonly string[] {
  return [plugin.id];
}

function canMentionInstalledPlugin(plugin: PluginListItem): boolean {
  return plugin.enabled && plugin.status === "running";
}

function toInstalledPluginMentionSuggestion(
  plugin: PluginListItem,
): InstalledPluginMentionSuggestion {
  return {
    kind: "plugin",
    pluginId: plugin.id,
    title: plugin.id,
    subtitle: plugin.version ? `v${plugin.version}` : null,
    replacement: plugin.id,
  };
}

export function buildInstalledPluginMentionSuggestions(
  args: BuildInstalledPluginMentionSuggestionsArgs,
): InstalledPluginMentionSuggestion[] {
  const trimmedQuery = args.query.trim();
  if (trimmedQuery.length === 0 || args.limit <= 0) {
    return [];
  }

  const candidates = args.plugins.filter(canMentionInstalledPlugin);
  const matches = fuzzyMatchText({
    items: candidates,
    query: trimmedQuery,
    getText: getInstalledPluginSearchTexts,
    limit: candidates.length,
  });

  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareCodepoint(left.item.id, right.item.id),
    )
    .slice(0, args.limit)
    .map((match) => toInstalledPluginMentionSuggestion(match.item));
}

/**
 * Map GET /plugins/mentions/search groups onto mention-menu suggestions
 * (plugin design §4.9). Group order is server-owned (plugin id, then
 * registration order); rows keep their provider's label so the menu can
 * section them per provider. The inserted pill text (`replacement`) is the
 * item title — the resource's `itemId` carries the machine reference.
 */
export function buildPluginMentionSuggestions(
  groups: readonly PluginMentionSearchGroup[],
): PromptMentionSuggestion[] {
  const suggestions: PromptMentionSuggestion[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const title = item.title.trim();
      if (title.length === 0) continue;
      suggestions.push({
        kind: "plugin",
        pluginId: group.pluginId,
        providerId: group.providerId,
        itemId: item.itemId,
        providerLabel: group.label,
        title,
        subtitle: item.subtitle,
        replacement: title,
      });
    }
  }
  return suggestions;
}
