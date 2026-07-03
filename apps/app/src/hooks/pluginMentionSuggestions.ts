import type { PluginMentionSearchGroup } from "./queries/plugin-contribution-queries";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";

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
