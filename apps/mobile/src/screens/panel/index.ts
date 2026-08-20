export {
  useOptionalPanel,
  usePanel,
  WorkspacePanelProvider,
  type PanelController,
  type WorkspacePanelProviderProps,
} from "./PanelProvider";
export {
  buildPanelStripEntries,
  createPanelViewState,
  createTabForOpenFileRequest,
  DEFAULT_FILES_LAUNCHER_PARAMS,
  describePanelTab,
  MOBILE_SUPPORTED_TAB_KINDS,
  panelReducer,
  resolvePanelActiveView,
  type FilesLauncherParams,
  type OpenFileRequest,
  type PanelAction,
  type PanelActiveView,
  type PanelLauncherId,
  type PanelOpenTarget,
  type PanelScope,
  type PanelStripEntry,
  type PanelStripTarget,
  type PanelTabDescriptor,
  type PanelViewState,
  type ProjectPanelScope,
  type ThreadPanelScope,
} from "./panel-model";
export {
  getPanelLauncherContent,
  getPanelTabContent,
  registerPanelLauncherContent,
  registerPanelTabContent,
  type PanelContentOptions,
  type PanelLauncherContentProps,
  type PanelTabContentProps,
  type PanelTabKind,
  type PanelTabOfKind,
} from "./registry";
export {
  UnregisteredLauncherContent,
  UnregisteredTabContent,
  UnsupportedTabContent,
} from "./PanelPlaceholders";
export { ThreadInfoTabContent } from "./ThreadInfoTabContent";
export { PanelToggleButton } from "./PanelToggleButton";
export { ThreadWorkspacePanelProvider } from "./ThreadWorkspacePanelProvider";
export {
  ProjectWorkspacePanelProvider,
  rootComposePanelStateId,
  type ProjectWorkspacePanelProviderProps,
} from "./ProjectWorkspacePanelProvider";

// Registers the built-in contents (Info, placeholders) and the feature
// registrations. Last on purpose: feature `register.ts` modules may import
// this barrel, so the exports above must exist before they evaluate.
import "./contents";
