import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  ExperimentalAppPanelSurface,
  ExperimentalFileOpenOptions,
  JsonValue,
} from "@get-bb/plugin-sdk";
import type { TerminalSession } from "@bb/server-contract";
import type { FileOpenerOverride } from "@/lib/plugin-slot-resolvers";

interface AppUrlOpenIntent {
  url: string;
}

export interface AppFilePreviewIntent extends ExperimentalFileOpenOptions {
  viewer?: FileOpenerOverride;
}

export interface AppFixedTabReference {
  ownerId: string;
  tabId: string;
}

export interface AppFixedTabOpenIntent {
  surface: ExperimentalAppPanelSurface;
  tab: AppFixedTabReference;
  target?: JsonValue;
}

interface AppNavigationHostCapabilities {
  openFileExternally?: (intent: ExperimentalFileOpenOptions) => boolean;
  openFilePreview?: (intent: AppFilePreviewIntent) => boolean;
  openFixedTab?: (intent: AppFixedTabOpenIntent) => boolean;
  openTerminal?: (session: TerminalSession) => boolean;
  openUrl?: (intent: AppUrlOpenIntent) => boolean;
}

interface ResolvedAppNavigationHostCapabilities {
  openFileExternally: (intent: ExperimentalFileOpenOptions) => boolean;
  openFilePreview: (intent: AppFilePreviewIntent) => boolean;
  openFixedTab: (intent: AppFixedTabOpenIntent) => boolean;
  openTerminal: (session: TerminalSession) => boolean;
  openUrl: (intent: AppUrlOpenIntent) => boolean;
}

const rejectNavigationIntent = () => false;
const DEFAULT_APP_NAVIGATION_HOST: ResolvedAppNavigationHostCapabilities = {
  openFileExternally: rejectNavigationIntent,
  openFilePreview: rejectNavigationIntent,
  openFixedTab: rejectNavigationIntent,
  openTerminal: rejectNavigationIntent,
  openUrl: rejectNavigationIntent,
};

const AppNavigationHostContext =
  createContext<ResolvedAppNavigationHostCapabilities>(
    DEFAULT_APP_NAVIGATION_HOST,
  );

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
      openFilePreview: capabilities.openFilePreview ?? parent.openFilePreview,
      openFixedTab: capabilities.openFixedTab ?? parent.openFixedTab,
      openTerminal: capabilities.openTerminal ?? parent.openTerminal,
      openUrl: capabilities.openUrl ?? parent.openUrl,
    }),
    [
      capabilities.openFileExternally,
      capabilities.openFilePreview,
      capabilities.openFixedTab,
      capabilities.openTerminal,
      capabilities.openUrl,
      parent.openFileExternally,
      parent.openFilePreview,
      parent.openFixedTab,
      parent.openTerminal,
      parent.openUrl,
    ],
  );
  return (
    <AppNavigationHostContext.Provider value={value}>
      {children}
    </AppNavigationHostContext.Provider>
  );
}

export function useAppNavigationHost() {
  return useContext(AppNavigationHostContext);
}
