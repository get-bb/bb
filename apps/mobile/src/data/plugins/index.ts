// Plugin management: the installed list, per-plugin settings / logs /
// updates, the catalog (browse + install), and marketplaces. Mirrors the
// web's plugin-settings-queries / plugin-catalog-queries / plugin-cache-owner
// on the active profile's SDK.
export {
  catalogInstallNeedsSourceConfirmation,
  describeCatalogInstall,
  describeMarketplace,
  describePluginRow,
  describePluginSettingsAvailability,
  filterPlugins,
  groupCatalogEntries,
  normalizeMarketplaceSourceInput,
  normalizePluginSourceInput,
  pluginDisplayName,
  pluginRemovalDescription,
  pluginRemovalLabel,
  pluginRowSignal,
  pluginRuntimeStatusPresentation,
  pluginSecretIsSet,
  pluginSettingFieldValue,
  pluginSettingsAvailability,
  pluginSettingsChanges,
  sortPlugins,
  summarizePluginUpdate,
  type PluginRowSignal,
  type PluginSettingDraft,
  type PluginStatusTone,
} from "./plugin-model";
export {
  PLUGIN_LOGS_DEFAULT_TAIL,
  toPluginLogLines,
  type PluginLogLine,
} from "./plugin-logs";
export {
  usePlugin,
  usePluginCatalogInstallPlan,
  usePluginCatalogSearch,
  usePluginList,
  usePluginLogs,
  usePluginMarketplaces,
  usePluginSettings,
  usePluginUpdates,
} from "./plugin-queries";
export {
  useAddMarketplace,
  useApplyPluginUpdate,
  useCheckPluginUpdates,
  useInstallPlugin,
  useRefreshMarketplaces,
  useReloadPlugins,
  useRemoveMarketplace,
  useRemovePlugin,
  useSetPluginEnabled,
  useUpdatePluginSettings,
} from "./plugin-mutations";
export { useServerSvgAsset } from "./server-svg-asset";
