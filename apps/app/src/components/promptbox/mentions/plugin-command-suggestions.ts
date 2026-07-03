import type { PluginSlashCommandContribution } from "@/hooks/queries/plugin-contribution-queries";
import type { PluginCommandSuggestion } from "./types";

/**
 * Filter plugin slash-command contributions against the composer's command
 * query (plugin design §4.9). Mirrors the server's provider-command
 * matching: case-insensitive substring on name or description, name-prefix
 * matches first, then alphabetical. Pure — the seam the menu-inclusion
 * tests exercise.
 */
export function filterPluginCommandSuggestions(
  commands: readonly PluginSlashCommandContribution[],
  query: string,
): PluginCommandSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  return commands
    .filter((command) => {
      if (normalizedQuery === "") return true;
      return (
        command.name.toLowerCase().includes(normalizedQuery) ||
        command.description.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((a, b) => {
      if (normalizedQuery !== "") {
        const aPrefix = a.name.toLowerCase().startsWith(normalizedQuery);
        const bPrefix = b.name.toLowerCase().startsWith(normalizedQuery);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((command) => ({
      kind: "plugin-command" as const,
      pluginId: command.pluginId,
      name: command.name,
      description: command.description,
    }));
}
