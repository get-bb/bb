import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
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

export interface ResolvedAppNavigationHostCapabilities {
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

export type AppNavigationSurfaceId = symbol;

const focusedSurfaces = new Map<
  AppNavigationSurfaceId,
  { current: ResolvedAppNavigationHostCapabilities }
>();
const focusedSurfaceListeners = new Set<() => void>();

function notifyFocusedSurfaceListeners(): void {
  for (const listener of [...focusedSurfaceListeners]) listener();
}

const AppNavigationSurfaceIdContext =
  createContext<AppNavigationSurfaceId | null>(null);

export function useAppNavigationSurfaceId(): AppNavigationSurfaceId | null {
  return useContext(AppNavigationSurfaceIdContext);
}

function FocusedSurfaceRegistration({
  surface,
  isFocused,
}: {
  surface: AppNavigationSurfaceId;
  isFocused: boolean;
}) {
  const host = useAppNavigationHost();
  const latest = useRef(host);
  useLayoutEffect(() => {
    latest.current = host;
  });
  useEffect(() => {
    if (!isFocused) return;
    focusedSurfaces.set(surface, latest);
    notifyFocusedSurfaceListeners();
    return () => {
      focusedSurfaces.delete(surface);
      notifyFocusedSurfaceListeners();
    };
  }, [isFocused, surface]);
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
  const [surface] = useState<AppNavigationSurfaceId>(() =>
    Symbol("app-navigation-surface"),
  );
  return (
    <AppNavigationHostProvider capabilities={capabilities}>
      <AppNavigationSurfaceIdContext.Provider value={surface}>
        <FocusedSurfaceRegistration surface={surface} isFocused={isFocused} />
        {children}
      </AppNavigationSurfaceIdContext.Provider>
    </AppNavigationHostProvider>
  );
}

export function useAppNavigationHostRef(): RefObject<ResolvedAppNavigationHostCapabilities> {
  return useRef(DEFAULT_APP_NAVIGATION_HOST);
}

export function AppNavigationHostCapture({
  hostRef,
}: {
  hostRef: RefObject<ResolvedAppNavigationHostCapabilities>;
}) {
  const host = useAppNavigationHost();
  useLayoutEffect(() => {
    hostRef.current = host;
  });
  return null;
}

export function getFocusedAppNavigationSurface(): ResolvedAppNavigationHostCapabilities | null {
  let focused: ResolvedAppNavigationHostCapabilities | null = null;
  for (const surface of focusedSurfaces.values()) focused = surface.current;
  return focused;
}

export function getFocusedAppNavigationSurfaceId(): AppNavigationSurfaceId | null {
  let focused: AppNavigationSurfaceId | null = null;
  for (const surface of focusedSurfaces.keys()) focused = surface;
  return focused;
}

export function subscribeFocusedAppNavigationSurface(
  listener: () => void,
): () => void {
  focusedSurfaceListeners.add(listener);
  return () => {
    focusedSurfaceListeners.delete(listener);
  };
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
