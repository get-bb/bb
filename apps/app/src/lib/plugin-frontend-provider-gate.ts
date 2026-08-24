/**
 * Which provider plugins' frontend bundles the page wants (docs/
 * provider-plugin-api.md §5, Q30): a provider plugin's app bundle loads
 * lazily on the first thread of that provider and never enters the boot
 * payload. This module is the boot-path-safe record of that demand — no
 * React, no plugin runtime — so the thread view can register interest before
 * the heavy `plugin-frontend` module has been imported, and the reconcile
 * pass reads it once that module runs.
 */

const wantedProviderPluginIds = new Set<string>();

/** The plugin ids whose provider threads have been opened this page load. */
export function getWantedProviderPluginIds(): ReadonlySet<string> {
  return wantedProviderPluginIds;
}

/**
 * Record that a thread of one of `pluginId`'s providers is open. Returns
 * true the first time a plugin is wanted, so the caller knows a reconcile is
 * due; later calls are no-ops.
 */
export function markProviderPluginFrontendWanted(pluginId: string): boolean {
  if (wantedProviderPluginIds.has(pluginId)) return false;
  wantedProviderPluginIds.add(pluginId);
  return true;
}

export function resetProviderPluginFrontendGateForTest(): void {
  wantedProviderPluginIds.clear();
}
