import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

/**
 * Enabled plugins that are not running and need the user to act: an
 * `engines.bb` mismatch after a bb upgrade, a factory crash, or a deleted
 * plugin directory. `needs-configuration` and `degraded` have their own
 * in-product prompts, so they do not count (#1915).
 */
export function pluginNeedsAttention(
  plugin: Pick<PluginListItem, "enabled" | "status">,
): boolean {
  return (
    plugin.enabled &&
    (plugin.status === "incompatible" ||
      plugin.status === "error" ||
      plugin.status === "missing")
  );
}

export function pluginsNeedingAttention(
  plugins: readonly PluginListItem[],
): PluginListItem[] {
  return plugins.filter(pluginNeedsAttention);
}

/** Tooltip / accessible name for the sidebar warning glyph. */
export function pluginAttentionLabel(
  plugins: readonly PluginListItem[],
): string {
  if (plugins.length !== 1) return `${plugins.length} plugins are not running`;
  const [plugin] = plugins;
  const name = plugin.name ?? plugin.id;
  const word =
    plugin.status === "incompatible" ? "incompatible" : "not running";
  const detail = plugin.statusDetail ?? "";
  return detail.length > 0 && detail.length <= 80
    ? `${name} is ${word}: ${detail}`
    : `${name} is ${word}`;
}
