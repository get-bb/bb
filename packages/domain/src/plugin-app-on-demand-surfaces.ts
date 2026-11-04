export const PLUGIN_APP_ON_DEMAND_SURFACES = [
  "settings-section",
  "environment-provider-inputs",
  "machine-provider-inputs",
] as const;

export type PluginAppOnDemandSurface =
  (typeof PLUGIN_APP_ON_DEMAND_SURFACES)[number];
