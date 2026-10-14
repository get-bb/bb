import type { InstalledPlugin } from "@bb/server-contract";

const PLUGIN_STATUSES_WITH_SETTINGS: readonly InstalledPlugin["status"][] = [
  "running",
  "needs-configuration",
  "degraded",
];

export function arePluginSettingsAvailable(
  plugin: Pick<InstalledPlugin, "enabled" | "status">,
): boolean {
  return (
    plugin.enabled && PLUGIN_STATUSES_WITH_SETTINGS.includes(plugin.status)
  );
}
