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
  type CollectedPluginAppRegistrations,
  type CollectedSidebarNavigationRegistration,
  collectPluginAppRegistrations,
} from "./plugin-app-registration-collector.js";
