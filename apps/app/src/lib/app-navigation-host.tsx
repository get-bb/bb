import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  ExperimentalFileOpenOptions,
  JsonValue,
} from "@get-bb/plugin-sdk";
import type { TerminalSession } from "@bb/server-contract";
import type { FileOpenerOverride } from "@/lib/plugin-slot-resolvers";
import {
  UNAVAILABLE_APP_PANEL_CONTROLLER,
  type AppPanelController,
} from "@/lib/app-fixed-tab-navigation";

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

export interface AppTabOpenIntent {
  tab: AppFixedTabReference;
  availability: "fixed" | "action";
  target?: JsonValue;
  params?: JsonValue;
  title?: string;
}

interface AppNavigationHostCapabilities {
  panel?: AppPanelController;
  openFileExternally?: (intent: ExperimentalFileOpenOptions) => boolean;
  openFilePreview?: (intent: AppFilePreviewIntent) => boolean;
  openTerminal?: (session: TerminalSession) => boolean;
  openUrl?: (intent: AppUrlOpenIntent) => boolean;
}

interface ResolvedAppNavigationHostCapabilities {
  panel: AppPanelController;
  openFileExternally: (intent: ExperimentalFileOpenOptions) => boolean;
  openFilePreview: (intent: AppFilePreviewIntent) => boolean;
  openTerminal: (session: TerminalSession) => boolean;
  openUrl: (intent: AppUrlOpenIntent) => boolean;
}

const rejectNavigationIntent = () => false;
const DEFAULT_APP_NAVIGATION_HOST: ResolvedAppNavigationHostCapabilities = {
  panel: UNAVAILABLE_APP_PANEL_CONTROLLER,
  openFileExternally: rejectNavigationIntent,
  openFilePreview: rejectNavigationIntent,
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
      panel: capabilities.panel ?? parent.panel,
      openFileExternally:
        capabilities.openFileExternally ?? parent.openFileExternally,
      openFilePreview: capabilities.openFilePreview ?? parent.openFilePreview,
      openTerminal: capabilities.openTerminal ?? parent.openTerminal,
      openUrl: capabilities.openUrl ?? parent.openUrl,
    }),
    [
      capabilities.panel,
      parent.panel,
      capabilities.openFileExternally,
      capabilities.openFilePreview,
      capabilities.openTerminal,
      capabilities.openUrl,
      parent.openFileExternally,
      parent.openFilePreview,
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
