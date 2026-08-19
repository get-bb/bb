import { useMemo } from "react";
import type { PluginRuntimeStatus } from "@bb/server-contract";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";

/**
 * Runtime statuses that mean an installed, enabled plugin is not doing its
 * job and the user has to act: an `engines.bb` mismatch after a host upgrade,
 * a factory crash, or a deleted plugin directory. `disabled` is a user
 * choice, `needs-configuration` and `degraded` already have their own
 * in-product prompts, so neither counts here (#1915).
 */
const PLUGIN_ATTENTION_STATUSES: ReadonlySet<PluginRuntimeStatus> =
  new Set<PluginRuntimeStatus>(["incompatible", "error", "missing"]);

export function pluginNeedsAttention(plugin: {
  status: PluginRuntimeStatus;
}): boolean {
  return PLUGIN_ATTENTION_STATUSES.has(plugin.status);
}

/** Installed plugins that are not running and need the user to act. */
export function pluginsNeedingAttention<
  T extends { status: PluginRuntimeStatus },
>(plugins: readonly T[]): T[] {
  return plugins.filter(pluginNeedsAttention);
}

export function pluginAttentionLabel(count: number): string {
  return count === 1
    ? "1 plugin needs attention"
    : `${count} plugins need attention`;
}

export interface PluginAttention {
  count: number;
  plugins: PluginListItem[];
}

interface UsePluginAttentionOptions {
  enabled?: boolean;
}

export function usePluginAttention(
  options?: UsePluginAttentionOptions,
): PluginAttention {
  const enabled = options?.enabled ?? true;
  const listQuery = usePluginList({ enabled });
  return useMemo(() => {
    const plugins = pluginsNeedingAttention(listQuery.data?.plugins ?? []);
    return { count: plugins.length, plugins };
  }, [listQuery.data?.plugins]);
}
