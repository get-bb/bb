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

export function pluginHasSettingsSections(
  plugin: Pick<InstalledPlugin, "app" | "enabled" | "id" | "status">,
  settingsSections: readonly { pluginId: string }[],
  includeUnloaded: boolean,
): boolean {
  if (settingsSections.some((section) => section.pluginId === plugin.id))
    return true;
  const bundle = plugin.app.bundle;
  return (
    includeUnloaded &&
    bundle !== null &&
    bundle.compatible &&
    bundle.onDemandSurfaces.includes("settings-section") &&
    arePluginSettingsAvailable(plugin)
  );
}
