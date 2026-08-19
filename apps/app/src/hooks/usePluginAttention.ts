import { useMemo } from "react";
import type { PluginAttentionEntry } from "@bb/server-contract";
import { usePluginAttention as usePluginAttentionQuery } from "@/hooks/queries/plugin-settings-queries";

/**
 * Longest `statusDetail` the sidebar glyph quotes verbatim. The server caps
 * the summary detail at `PLUGIN_ATTENTION_DETAIL_MAX_LENGTH` (200); a
 * tooltip wants less, so a longer detail falls back to the status word.
 */
const SHORT_DETAIL_MAX_LENGTH = 80;

/**
 * The server's `engines.bb` mismatch detail ("requires bb >=0.38.0 <0.39.0,
 * this is 0.39.0"). `incompatible` also covers a plugin SDK range mismatch
 * ("requires bb plugin SDK …") and a broken packaged artifact, so only this
 * shape may be phrased as a conflict with the running bb version.
 */
const BB_ENGINE_MISMATCH_DETAIL = /^requires bb (?!plugin SDK)/u;

function pluginDisplayName(plugin: PluginAttentionEntry): string {
  return plugin.name ?? plugin.id;
}

/**
 * Tooltip / accessible name for the sidebar warning glyph. One plugin is
 * named with its reason ("Notify is incompatible with bb 0.39.0" for an
 * engines mismatch, otherwise the server's short `statusDetail`); several
 * plugins collapse to a count, and the Installed plugins view lists each one.
 */
export function pluginAttentionLabel(
  plugins: readonly PluginAttentionEntry[],
  bbVersion: string | undefined,
): string {
  if (plugins.length !== 1) {
    return `${plugins.length} plugins are not running`;
  }
  const plugin = plugins[0]!;
  const name = pluginDisplayName(plugin);
  const detail = plugin.statusDetail?.trim() ?? "";
  if (
    plugin.status === "incompatible" &&
    bbVersion !== undefined &&
    BB_ENGINE_MISMATCH_DETAIL.test(detail)
  ) {
    return `${name} is incompatible with bb ${bbVersion}`;
  }
  if (plugin.status === "incompatible") {
    return detail.length > 0 && detail.length <= SHORT_DETAIL_MAX_LENGTH
      ? `${name} is incompatible: ${detail}`
      : `${name} is incompatible`;
  }
  if (detail.length > 0 && detail.length <= SHORT_DETAIL_MAX_LENGTH) {
    return `${name} is not running: ${detail}`;
  }
  return `${name} is not running (${plugin.status})`;
}

export interface PluginAttention {
  count: number;
  plugins: PluginAttentionEntry[];
}

interface UsePluginAttentionOptions {
  enabled?: boolean;
}

/**
 * Installed plugins that are enabled but not running. The server decides
 * which statuses count (`pluginNeedsAttention` in `@bb/server-contract`);
 * this hook only reads the summary for the sidebar footer glyph. The state is
 * derived from the live summary and never stored, so the glyph disappears as
 * soon as the plugin updates, bb upgrades, or the user reloads, disables, or
 * uninstalls the plugin.
 */
export function usePluginAttention(
  options?: UsePluginAttentionOptions,
): PluginAttention {
  const enabled = options?.enabled ?? true;
  const query = usePluginAttentionQuery({ enabled });
  return useMemo(() => {
    const plugins = query.data?.plugins ?? [];
    return { count: plugins.length, plugins };
  }, [query.data?.plugins]);
}
