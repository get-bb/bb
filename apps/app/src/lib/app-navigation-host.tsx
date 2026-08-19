import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import type { FileTabViewerOverride } from "@/components/plugin/file-opener-tabs";

export interface AppUrlOpenIntent {
  url: string;
}

export interface AppFilePreviewIntent extends ExperimentalFileOpenOptions {
  /** Internal per-activation override used by BB-owned Open with… menus. */
  viewer?: FileTabViewerOverride;
}

export interface AppNavigationHostCapabilities {
  openFileExternally?: (intent: ExperimentalFileOpenOptions) => boolean;
  openFilePreview?: (intent: AppFilePreviewIntent) => boolean;
  openUrl?: (intent: AppUrlOpenIntent) => boolean;
}

interface ResolvedAppNavigationHostCapabilities {
  openFileExternally: ((intent: ExperimentalFileOpenOptions) => boolean) | null;
  openFilePreview: ((intent: AppFilePreviewIntent) => boolean) | null;
  openUrl: ((intent: AppUrlOpenIntent) => boolean) | null;
}

const AppNavigationHostContext =
  createContext<ResolvedAppNavigationHostCapabilities | null>(null);

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
        capabilities.openFileExternally ?? parent?.openFileExternally ?? null,
      openFilePreview:
        capabilities.openFilePreview ?? parent?.openFilePreview ?? null,
      openUrl: capabilities.openUrl ?? parent?.openUrl ?? null,
    }),
    [
      capabilities.openFileExternally,
      capabilities.openFilePreview,
      capabilities.openUrl,
      parent?.openFileExternally,
      parent?.openFilePreview,
      parent?.openUrl,
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
  const host = useContext(AppNavigationHostContext);
  const openFileExternally = useCallback(
    (intent: ExperimentalFileOpenOptions): boolean =>
      host?.openFileExternally?.(intent) ?? false,
    [host?.openFileExternally],
  );
  const openFilePreview = useCallback(
    (intent: AppFilePreviewIntent): boolean =>
      host?.openFilePreview?.(intent) ?? false,
    [host?.openFilePreview],
  );
  const openUrl = useCallback(
    (intent: AppUrlOpenIntent): boolean => host?.openUrl?.(intent) ?? false,
    [host?.openUrl],
  );
  return useMemo(
    () => ({ openFileExternally, openFilePreview, openUrl }),
    [openFileExternally, openFilePreview, openUrl],
  );
}
