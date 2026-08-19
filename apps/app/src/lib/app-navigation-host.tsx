import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type {
  ExperimentalAppPanelSurface,
  ExperimentalFileOpenOptions,
  JsonValue,
} from "@get-bb/plugin-sdk";
import type { FileTabViewerOverride } from "@/components/plugin/file-opener-tabs";

export interface AppUrlOpenIntent {
  url: string;
}

export interface AppFilePreviewIntent extends ExperimentalFileOpenOptions {
  /** Internal per-activation override used by BB-owned Open with… menus. */
  viewer?: FileTabViewerOverride;
}

/** Internal identity. Public plugin callers never supply `ownerId`. */
export interface AppFixedTabReference {
  ownerId: string;
  tabId: string;
}

export interface AppFixedTabOpenIntent {
  surface: ExperimentalAppPanelSurface;
  tab: AppFixedTabReference;
  target?: JsonValue;
}

export interface AppNavigationHostCapabilities {
  openFileExternally?: (intent: ExperimentalFileOpenOptions) => boolean;
  openFilePreview?: (intent: AppFilePreviewIntent) => boolean;
  openFixedTab?: (intent: AppFixedTabOpenIntent) => boolean;
  openUrl?: (intent: AppUrlOpenIntent) => boolean;
}

interface ResolvedAppNavigationHostCapabilities {
  openFileExternally: (intent: ExperimentalFileOpenOptions) => boolean;
  openFilePreview: (intent: AppFilePreviewIntent) => boolean;
  openFixedTab: (intent: AppFixedTabOpenIntent) => boolean;
  openUrl: (intent: AppUrlOpenIntent) => boolean;
}

const rejectNavigationIntent = () => false;
const DEFAULT_APP_NAVIGATION_HOST: ResolvedAppNavigationHostCapabilities = {
  openFileExternally: rejectNavigationIntent,
  openFilePreview: rejectNavigationIntent,
  openFixedTab: rejectNavigationIntent,
  openUrl: rejectNavigationIntent,
};

const AppNavigationHostContext =
  createContext<ResolvedAppNavigationHostCapabilities>(
    DEFAULT_APP_NAVIGATION_HOST,
  );

/**
 * Adds the navigation capabilities owned by one app surface. Providers compose:
 * an omitted capability inherits the nearest outer host instead of disabling it.
 */
export function AppNavigationHostProvider({
  capabilities,
  children,
}: {
  capabilities: AppNavigationHostCapabilities;
  children: ReactNode;
}) {
  const parent = useContext(AppNavigationHostContext);
  const value = useMemo<ResolvedAppNavigationHostCapabilities>(
    () => ({
      openFileExternally:
        capabilities.openFileExternally ?? parent.openFileExternally,
      openFilePreview:
        capabilities.openFilePreview ?? parent.openFilePreview,
      openFixedTab: capabilities.openFixedTab ?? parent.openFixedTab,
      openUrl: capabilities.openUrl ?? parent.openUrl,
    }),
    [
      capabilities.openFileExternally,
      capabilities.openFilePreview,
      capabilities.openFixedTab,
      capabilities.openUrl,
      parent.openFileExternally,
      parent.openFilePreview,
      parent.openFixedTab,
      parent.openUrl,
    ],
  );
  return (
    <AppNavigationHostContext.Provider value={value}>
      {children}
    </AppNavigationHostContext.Provider>
  );
}

/** Semantic navigation intents accepted by the current app surface. */
export function useAppNavigationHost() {
  return useContext(AppNavigationHostContext);
}
