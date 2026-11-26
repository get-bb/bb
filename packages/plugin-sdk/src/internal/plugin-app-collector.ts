export {
  type ExperimentalSidebarFooterCommandKind,
  type ExperimentalSidebarFooterRuntimeSnapshot,
  type ExperimentalSidebarFooterItemRuntime,
  type CollectedExperimentalSidebarFooterItem,
  type CollectedManagedSidebarFooterItem,
  type CollectedCompatibilitySidebarFooterItem,
  type CollectedSidebarFooterItem,
  adaptSidebarFooterAction,
  getCollectedSidebarFooterItems,
} from "./sidebar-footer-runtime.js";
export {
  type CollectedPluginProviderIconRegistration,
  type CollectedPluginCommandRegistration,
  type CollectedPluginMessageActionRegistration,
  type CollectedPluginAppRegistrations,
  type LegacyThreadPanelActionRegistration,
  type LegacyThreadHeaderActionRegistration,
  type LegacyNavPanelRegistration,
  type CollectedSidebarNavigationRegistration,
  type CollectedThreadContextCardSectionRegistration,
  collectPluginAppRegistrations,
} from "./plugin-app-registration-collector.js";
export {
  PLUGIN_APP_COMPONENT_FIELDS,
  registeredComponents,
  registrationComponents,
  type PluginAppComponentPath,
} from "./plugin-app-component-fields.js";
