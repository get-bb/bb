import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

/**
 * The Layer 1 rule (plugin marketplaces design, "UI design (locked)"): a row
 * earns at most one pill, and only when actionable. A failed update that
 * rolled back outranks an available update — the user should know a rollback
 * happened before applying anything else. Newer-but-incompatible releases
 * and pinned sources never badge the list; they surface on the detail page.
 */

export type PluginRowSignal =
  | { kind: "update"; version: string }
  | { kind: "attention" };

export function pluginRowSignal(plugin: PluginListItem): PluginRowSignal | null {
  const state = plugin.updateState;
  // Rollbacks and broken loads both need the user; either wins the row's
  // single pill slot.
  if (
    state.lastFailure !== null ||
    plugin.status === "error" ||
    plugin.status === "incompatible"
  ) {
    return { kind: "attention" };
  }
  if (state.availableVersion !== null) {
    return { kind: "update", version: state.availableVersion };
  }
  return null;
}

/** The detail-page banner mirrors the row pill's update case. */
export function pluginUpdateAvailableVersion(
  plugin: PluginListItem,
): string | null {
  const signal = pluginRowSignal(plugin);
  return signal?.kind === "update" ? signal.version : null;
}
