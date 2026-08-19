import { useMemo } from "react";
import type { PluginAttentionEntry } from "@bb/server-contract";
import { usePluginAttention as usePluginAttentionQuery } from "@/hooks/queries/plugin-settings-queries";

export function pluginAttentionLabel(count: number): string {
  return count === 1
    ? "1 plugin needs attention"
    : `${count} plugins need attention`;
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
 * this hook only reads the summary for the sidebar chip and the Extensions
 * badge.
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
