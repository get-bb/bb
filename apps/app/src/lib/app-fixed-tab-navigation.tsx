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
import { atom, useAtomValue, useStore } from "jotai";
import { atomFamily } from "jotai-family";
import type {
  ExperimentalFixedTabTargetContract,
  ExperimentalPanelTabs,
  JsonValue,
} from "@get-bb/plugin-sdk";
import { jsonValueSchema } from "@bb/domain";
import type {
  AppTabOpenIntent,
  AppFixedTabReference,
} from "@/lib/app-navigation-host";
import {
  areExperimentalPanelTabsEqual,
  EMPTY_APP_PANEL_TABS_STATE,
  toExperimentalPanelTabs,
  type AppPanelTabsState,
} from "@/lib/app-panel-tabs";

export interface AppFixedTabDestination {
  availability?: "fixed" | "action";
  open(
    target: JsonValue | undefined,
    options?: { params?: JsonValue; title?: string },
  ): boolean;
  panelTabId(params: JsonValue | undefined): string | null;
  tab: AppFixedTabReference;
}

interface AppPanelTabsStore {
  getTabs(): ExperimentalPanelTabs;
  subscribeTabs(listener: () => void): () => void;
  publishTabs(state: AppPanelTabsState): void;
  selectTab(key: string): boolean;
  closeTab(key: string): boolean;
  renderTabIcon(key: string): ReactNode;
}

function createAppPanelTabsStore(): AppPanelTabsStore {
  let state = EMPTY_APP_PANEL_TABS_STATE;
  let snapshot = toExperimentalPanelTabs(state);
  const listeners = new Set<() => void>();
  const find = (key: string) =>
    state.entries.find((entry) => entry.key === key);
  return {
    getTabs: () => snapshot,
    subscribeTabs: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publishTabs: (next) => {
      state = next;
      const nextSnapshot = toExperimentalPanelTabs(next);
      if (areExperimentalPanelTabsEqual(snapshot, nextSnapshot)) return;
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
    selectTab: (key) => {
      const entry = find(key);
      if (entry === undefined) return false;
      entry.select();
      return true;
    },
    closeTab: (key) => {
      const entry = find(key);
      if (entry === undefined || !entry.closable) return false;
      entry.close();
      return true;
    },
    renderTabIcon: (key) => find(key)?.icon ?? null,
  };
}

export interface AppPanelController extends AppPanelTabsStore {
  openTab(intent: AppTabOpenIntent): boolean;
  toggleTab(intent: AppTabOpenIntent): boolean;
  close(): boolean;
}

interface AppPanelSurface {
  activeTabId: string | null;
  close(): void;
  destinations: readonly AppFixedTabDestination[];
}

export function getPluginFixedTabOwnerId(
  pluginId: string,
  panelId: string,
): string {
  return `plugin:${pluginId}:${panelId}`;
}

export function getThreadFixedTabOwnerId(pluginId: string): string {
  return `plugin-thread:${pluginId}`;
}

const rejectPanelIntent = () => false;
export const UNAVAILABLE_APP_PANEL_CONTROLLER: AppPanelController = {
  openTab: rejectPanelIntent,
  toggleTab: rejectPanelIntent,
  close: rejectPanelIntent,
  ...createAppPanelTabsStore(),
  publishTabs: () => undefined,
};

function resolveAppTabIntent(
  destinations: readonly AppFixedTabDestination[],
  intent: AppTabOpenIntent,
) {
  const { availability } = intent;
  if (
    availability === "fixed"
      ? intent.params !== undefined || intent.title !== undefined
      : intent.target !== undefined
  )
    return null;
  if (intent.title !== undefined && typeof intent.title !== "string")
    return null;
  const params =
    intent.params === undefined
      ? null
      : jsonValueSchema.safeParse(intent.params);
  const target =
    intent.target === undefined
      ? null
      : jsonValueSchema.safeParse(intent.target);
  if (params?.success === false || target?.success === false) return null;
  const destination = destinations.find(
    (candidate) =>
      candidate.tab.ownerId === intent.tab.ownerId &&
      candidate.tab.tabId === intent.tab.tabId &&
      (candidate.availability ?? "fixed") === availability,
  );
  if (destination === undefined) return null;
  return {
    destination,
    params: params?.success ? params.data : undefined,
    target: target?.success ? target.data : undefined,
    title: intent.title,
  };
}

function openResolvedTab(
  resolved: NonNullable<ReturnType<typeof resolveAppTabIntent>>,
): boolean {
  const { destination, params, target, title } = resolved;
  return (destination.availability ?? "fixed") === "fixed"
    ? destination.open(target)
    : destination.open(undefined, {
        ...(params === undefined ? {} : { params }),
        ...(title === undefined ? {} : { title }),
      });
}

function openSurfaceTab(surface: AppPanelSurface, intent: AppTabOpenIntent) {
  const resolved = resolveAppTabIntent(surface.destinations, intent);
  return resolved !== null && openResolvedTab(resolved);
}

function toggleSurfaceTab(surface: AppPanelSurface, intent: AppTabOpenIntent) {
  const resolved = resolveAppTabIntent(surface.destinations, intent);
  if (resolved === null) return false;
  if (
    surface.activeTabId !== null &&
    surface.activeTabId === resolved.destination.panelTabId(resolved.params)
  ) {
    surface.close();
    return true;
  }
  return openResolvedTab(resolved);
}

function closeSurface(surface: AppPanelSurface) {
  surface.close();
  return true;
}

export function createAppPanelController(
  getSurface: () => AppPanelSurface,
): AppPanelController {
  return {
    openTab: (intent) => openSurfaceTab(getSurface(), intent),
    toggleTab: (intent) => toggleSurfaceTab(getSurface(), intent),
    close: () => closeSurface(getSurface()),
    ...createAppPanelTabsStore(),
  };
}

const focusedControllers = new Map<symbol, AppPanelController>();

export function useAppPanelController({
  isFocused,
  ...surface
}: AppPanelSurface & { isFocused: boolean }): AppPanelController {
  const surfaceRef = useRef(surface);
  useLayoutEffect(() => {
    surfaceRef.current = surface;
  });
  const [controller] = useState<AppPanelController>(() => ({
    openTab: (intent) => openSurfaceTab(surfaceRef.current, intent),
    toggleTab: (intent) => toggleSurfaceTab(surfaceRef.current, intent),
    close: () => closeSurface(surfaceRef.current),
    ...createAppPanelTabsStore(),
  }));
  useEffect(() => {
    if (!isFocused) return;
    const token = Symbol("app-panel-controller");
    focusedControllers.set(token, controller);
    return () => {
      focusedControllers.delete(token);
    };
  }, [controller, isFocused]);
  return controller;
}

export function getFocusedAppPanelController(): AppPanelController | null {
  let focused: AppPanelController | null = null;
  for (const controller of focusedControllers.values()) focused = controller;
  return focused;
}

export function resetFocusedAppPanelControllersForTest(): void {
  focusedControllers.clear();
}

interface AppFixedTabTargetSnapshot {
  ownerId: string;
  sequence: number;
  tabId: string;
  target: JsonValue;
}

export interface AppFixedTabTargetState extends AppFixedTabTargetSnapshot {
  clear(): void;
}

const fixedTabTargetAtomFamily = atomFamily((_targetKey: string) =>
  atom<{ sequence: number; target: JsonValue } | null>(null),
);

export function useSetFixedTabTarget() {
  const store = useStore();
  return useMemo(
    () =>
      (
        targetKey: string,
        contract: ExperimentalFixedTabTargetContract<JsonValue> | undefined,
        target: JsonValue,
      ): boolean => {
        const result = jsonValueSchema.safeParse(target);
        if (!result.success || contract === undefined) return false;
        try {
          if (!contract.validate(result.data)) return false;
        } catch {
          return false;
        }
        store.set(fixedTabTargetAtomFamily(targetKey), (current) => ({
          sequence: (current?.sequence ?? 0) + 1,
          target: result.data,
        }));
        return true;
      },
    [store],
  );
}

export function FixedTabTargetScope({
  children,
  ownerId,
  tabId,
  targetKey,
}: {
  children: ReactNode;
  ownerId: string;
  tabId: string;
  targetKey: string;
}) {
  const store = useStore();
  const targetAtom = fixedTabTargetAtomFamily(targetKey);
  const snapshot = useAtomValue(targetAtom);
  const state = useMemo<AppFixedTabTargetState | null>(() => {
    if (snapshot === null) return null;
    const { sequence } = snapshot;
    return {
      ...snapshot,
      ownerId,
      tabId,
      clear: () => {
        store.set(targetAtom, (current) =>
          current?.sequence === sequence ? null : current,
        );
      },
    };
  }, [ownerId, snapshot, store, tabId, targetAtom]);
  return (
    <AppFixedTabTargetContext.Provider value={state}>
      {children}
    </AppFixedTabTargetContext.Provider>
  );
}

const AppFixedTabTargetContext = createContext<AppFixedTabTargetState | null>(
  null,
);

export function useAppFixedTabTarget(
  ownerId: string,
  tabId: string,
): AppFixedTabTargetState | null {
  const state = useContext(AppFixedTabTargetContext);
  return state?.ownerId === ownerId && state.tabId === tabId ? state : null;
}
