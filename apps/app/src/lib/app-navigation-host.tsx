import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

export interface AppUrlOpenIntent {
  url: string;
}

export interface AppNavigationHostCapabilities {
  openUrl?: (intent: AppUrlOpenIntent) => boolean;
}

interface ResolvedAppNavigationHostCapabilities {
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
      openUrl: capabilities.openUrl ?? parent?.openUrl ?? null,
    }),
    [capabilities.openUrl, parent?.openUrl],
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
  const openUrl = useCallback(
    (intent: AppUrlOpenIntent): boolean => host?.openUrl?.(intent) ?? false,
    [host?.openUrl],
  );
  return useMemo(() => ({ openUrl }), [openUrl]);
}
