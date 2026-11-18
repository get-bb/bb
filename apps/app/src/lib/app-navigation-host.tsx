import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

const focusedSurfaces = new Map<
  symbol,
  { current: ResolvedAppNavigationHostCapabilities }
>();

function FocusedSurfaceRegistration({ isFocused }: { isFocused: boolean }) {
  const host = useAppNavigationHost();
  const latest = useRef(host);
  useLayoutEffect(() => {
    latest.current = host;
  });
  useEffect(() => {
    if (!isFocused) return;
    const token = Symbol("app-navigation-surface");
    focusedSurfaces.set(token, latest);
    return () => {
      focusedSurfaces.delete(token);
    };
  }, [isFocused]);
  return null;
}

export function AppNavigationSurfaceProvider({
  capabilities,
  isFocused,
  children,
}: {
  capabilities: AppNavigationHostCapabilities;
  isFocused: boolean;
  children: ReactNode;
}) {
  return (
    <AppNavigationHostProvider capabilities={capabilities}>
      <FocusedSurfaceRegistration isFocused={isFocused} />
      {children}
    </AppNavigationHostProvider>
  );
}

function getFocusedAppNavigationSurface(): ResolvedAppNavigationHostCapabilities | null {
  let focused: ResolvedAppNavigationHostCapabilities | null = null;
  for (const surface of focusedSurfaces.values()) focused = surface.current;
  return focused;
}

export function getFocusedAppPanelController(): AppPanelController | null {
  return getFocusedAppNavigationSurface()?.panel ?? null;
}

export function resetFocusedAppNavigationSurfacesForTest(): void {
  focusedSurfaces.clear();
}

export function FocusedAppNavigationSurfaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const parent = useAppNavigationHost();
  const latestParent = useRef(parent);
  useLayoutEffect(() => {
    latestParent.current = parent;
  });
  const [capabilities] = useState(() => {
    const host = () => getFocusedAppNavigationSurface() ?? latestParent.current;
    return {
      openFileExternally: (intent: ExperimentalFileOpenOptions) =>
        host().openFileExternally(intent),
      openFilePreview: (intent: AppFilePreviewIntent) =>
        host().openFilePreview(intent),
      openTerminal: (session: TerminalSession) => host().openTerminal(session),
      openUrl: (intent: AppUrlOpenIntent) => host().openUrl(intent),
    };
  });
  return (
    <AppNavigationHostProvider capabilities={capabilities}>
      {children}
    </AppNavigationHostProvider>
  );
}
