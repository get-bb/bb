import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { atom } from "jotai";
import { useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { createLocalStorageSyncStorage } from "./browser-storage";
import { useThreadTabs } from "@/hooks/queries/thread-tabs-query";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  createGitDiffFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  pruneFixedPanelTabsStorage,
  serializeFixedPanelTabsState,
  type FixedPanelTab,
  type FixedPanelTabsState,
  type TerminalFixedPanelTab,
} from "./fixed-panel-tabs-state";
import { type ThreadSecondaryPanel } from "./thread-secondary-panel";
import {
  areThreadTabListsEquivalent,
  hasPendingThreadTabsWrite,
  reconcileFixedPanelTabsState,
  scheduleLocalThreadTabsMigration,
  scheduleThreadTabsPersistence,
} from "./thread-tabs-sync";

const FIXED_PANEL_TABS_TOUCH_THROTTLE_MS = 60 * 1000;

type FixedPanelTabsPanelStateId = string | null | undefined;
type FixedPanelTabsSyncThreadId = string | null | undefined;

export type FixedPanelTabsStateUpdater = (
  state: FixedPanelTabsState,
) => FixedPanelTabsState;

interface LastFixedPanelTabsTouch {
  threadId: FixedPanelTabsPanelStateId;
  touchedAt: number;
}

type FixedPanelSecondaryPanelSetter = (panel: ThreadSecondaryPanel) => void;
type FixedPanelSecondaryPanelOpener = () => void;
type FixedPanelSecondaryPanelCloser = () => void;
type FixedPanelTerminalIdSetter = (terminalId: string | null) => void;
type FixedPanelTerminalIdRemover = (terminalId: string) => void;

function hasThreadId(threadId: string | null | undefined): threadId is string {
  return threadId !== null && threadId !== undefined && threadId.length > 0;
}

function touchFixedPanelTabsState(
  state: FixedPanelTabsState,
  now: number,
): FixedPanelTabsState {
  return {
    ...state,
    lastUsedAt: now,
  };
}

const fixedPanelTabsStateStorage =
  createLocalStorageSyncStorage<FixedPanelTabsState>({
    parse: (storedValue, initialValue) =>
      parseFixedPanelTabsState({
        initialValue,
        now: Date.now(),
        storedValue,
      }),
    serialize: (state) => serializeFixedPanelTabsState({ state }),
  });

const disabledFixedPanelTabsStateAtom = atom(EMPTY_FIXED_PANEL_TABS_STATE);

const fixedPanelTabsStateAtomFamily = atomFamily((threadId: string) =>
  atomWithStorage<FixedPanelTabsState>(
    getFixedPanelTabsStateStorageKey({ threadId }),
    EMPTY_FIXED_PANEL_TABS_STATE,
    fixedPanelTabsStateStorage,
    { getOnInit: true },
  ),
);

function getFixedPanelTabsStateAtom(threadId: string | null | undefined) {
  return hasThreadId(threadId)
    ? fixedPanelTabsStateAtomFamily(threadId)
    : disabledFixedPanelTabsStateAtom;
}

function buildSecondaryPanelTab(panel: ThreadSecondaryPanel): FixedPanelTab {
  if (panel === "git-diff") return createGitDiffFixedPanelTab();
  return createThreadInfoFixedPanelTab();
}

function getSecondaryPanelTabId(panel: ThreadSecondaryPanel): string {
  return buildSecondaryPanelTab(panel).id;
}

function findActiveTerminalTab(
  state: FixedPanelTabsState,
): TerminalFixedPanelTab | null {
  const activeTabId = state.secondary.activeTabId;
  if (activeTabId === null) {
    return null;
  }

  const activeTab = state.secondary.tabs.find((tab) => tab.id === activeTabId);
  return activeTab?.kind === "terminal" ? activeTab : null;
}

function upsertTerminalTab(
  tabs: readonly FixedPanelTab[],
  terminalId: string,
): readonly FixedPanelTab[] {
  const nextTab = createTerminalFixedPanelTab({ terminalId });
  const existingTab = tabs.find((tab) => tab.id === nextTab.id);
  return existingTab ? tabs : [...tabs, nextTab];
}

function removeTerminalTab(
  tabs: readonly FixedPanelTab[],
  terminalId: string,
): readonly FixedPanelTab[] {
  const terminalTab = createTerminalFixedPanelTab({ terminalId });
  const nextTabs = tabs.filter((tab) => tab.id !== terminalTab.id);
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

function ensureSecondaryPanelTab(
  tabs: readonly FixedPanelTab[],
  panel: ThreadSecondaryPanel,
): readonly FixedPanelTab[] {
  const tabId = getSecondaryPanelTabId(panel);
  return tabs.some((tab) => tab.id === tabId)
    ? tabs
    : [...tabs, buildSecondaryPanelTab(panel)];
}

function hasSecondaryPanelTab(
  tabs: readonly FixedPanelTab[],
  activeTabId: string | null,
): boolean {
  return activeTabId !== null && tabs.some((tab) => tab.id === activeTabId);
}

function openFixedSecondaryPanelState(
  current: FixedPanelTabsState,
): FixedPanelTabsState {
  if (
    hasSecondaryPanelTab(current.secondary.tabs, current.secondary.activeTabId)
  ) {
    if (current.secondary.isOpen) {
      return current;
    }
    return {
      ...current,
      secondary: {
        ...current.secondary,
        isOpen: true,
      },
    };
  }

  const panel: ThreadSecondaryPanel = "thread-info";
  const tabs = ensureSecondaryPanelTab(current.secondary.tabs, panel);
  const activeTabId = getSecondaryPanelTabId(panel);
  return {
    ...current,
    secondary: {
      tabs,
      activeTabId,
      isOpen: true,
    },
  };
}

function closeFixedSecondaryPanelState(
  current: FixedPanelTabsState,
): FixedPanelTabsState {
  if (!current.secondary.isOpen) {
    return current;
  }
  return {
    ...current,
    secondary: {
      ...current.secondary,
      isOpen: false,
    },
  };
}

export function useFixedPanelTabsStorageMaintenance(
  panelStateId: FixedPanelTabsPanelStateId,
): void {
  useEffect(() => {
    const now = Date.now();
    pruneFixedPanelTabsStorage({ now });
  }, [panelStateId]);
}

export function useFixedPanelTabsState(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): FixedPanelTabsState {
  const stateAtom = getFixedPanelTabsStateAtom(panelStateId);
  const state = useAtomValue(stateAtom);
  const setState = useSetAtom(stateAtom);
  const queryClient = useQueryClient();
  const resolvedThreadId = hasThreadId(syncThreadId) ? syncThreadId : null;
  const tabsQuery = useThreadTabs(resolvedThreadId ?? "", {
    enabled: resolvedThreadId !== null,
  });

  useEffect(() => {
    if (resolvedThreadId === null || tabsQuery.data === undefined) {
      return;
    }
    if (hasPendingThreadTabsWrite(queryClient, resolvedThreadId)) {
      return;
    }
    if (tabsQuery.data.revision === 0 && state.secondary.tabs.length > 0) {
      scheduleLocalThreadTabsMigration({
        queryClient,
        tabs: state.secondary.tabs,
        threadId: resolvedThreadId,
      });
      return;
    }
    setState((current) =>
      reconcileFixedPanelTabsState(current, tabsQuery.data.tabs),
    );
  }, [
    queryClient,
    resolvedThreadId,
    setState,
    state.secondary.tabs,
    tabsQuery.data,
  ]);

  return state;
}

export function useUpdateFixedPanelTabsState(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): (update: FixedPanelTabsStateUpdater) => void {
  const setState = useSetAtom(getFixedPanelTabsStateAtom(panelStateId));
  const queryClient = useQueryClient();
  return useCallback(
    (update: FixedPanelTabsStateUpdater) => {
      if (!hasThreadId(panelStateId)) return;
      const now = Date.now();
      let tabsToPersist: readonly FixedPanelTab[] | null = null;
      setState((current) => {
        const next = update(current);
        if (next === current) {
          return current;
        }
        const touched = touchFixedPanelTabsState(next, now);
        if (
          !areThreadTabListsEquivalent(
            current.secondary.tabs,
            touched.secondary.tabs,
          )
        ) {
          tabsToPersist = touched.secondary.tabs;
        }
        return touched;
      });
      if (tabsToPersist !== null && hasThreadId(syncThreadId)) {
        scheduleThreadTabsPersistence({
          tabs: tabsToPersist,
          queryClient,
          threadId: syncThreadId,
        });
      }
    },
    [panelStateId, queryClient, setState, syncThreadId],
  );
}

export function useTouchFixedPanelTabsState(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): () => void {
  const updateState = useUpdateFixedPanelTabsState(panelStateId, syncThreadId);
  const lastTouchRef = useRef<LastFixedPanelTabsTouch | null>(null);
  return useCallback(() => {
    const now = Date.now();
    if (
      lastTouchRef.current !== null &&
      lastTouchRef.current.threadId === panelStateId &&
      now - lastTouchRef.current.touchedAt < FIXED_PANEL_TABS_TOUCH_THROTTLE_MS
    ) {
      return;
    }
    lastTouchRef.current = {
      threadId: panelStateId,
      touchedAt: now,
    };
    updateState((current) => {
      if (!current.secondary.isOpen && current.secondary.tabs.length === 0) {
        return current;
      }
      if (now - current.lastUsedAt < FIXED_PANEL_TABS_TOUCH_THROTTLE_MS) {
        return current;
      }
      return { ...current };
    });
  }, [panelStateId, updateState]);
}

export function useSetFixedSecondaryPanelTab(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): FixedPanelSecondaryPanelSetter {
  const updateState = useUpdateFixedPanelTabsState(panelStateId, syncThreadId);
  return useCallback(
    (panel: ThreadSecondaryPanel) => {
      updateState((current) => {
        const tabs = ensureSecondaryPanelTab(current.secondary.tabs, panel);
        const activeTabId = getSecondaryPanelTabId(panel);
        if (
          tabs === current.secondary.tabs &&
          current.secondary.activeTabId === activeTabId &&
          current.secondary.isOpen
        ) {
          return current;
        }
        return {
          ...current,
          secondary: {
            tabs,
            activeTabId,
            isOpen: true,
          },
        };
      });
    },
    [updateState],
  );
}

export function useCloseFixedSecondaryPanel(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): FixedPanelSecondaryPanelCloser {
  const updateState = useUpdateFixedPanelTabsState(panelStateId, syncThreadId);
  return useCallback(() => {
    updateState(closeFixedSecondaryPanelState);
  }, [updateState]);
}

export function useOpenFixedSecondaryPanel(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): FixedPanelSecondaryPanelOpener {
  const updateState = useUpdateFixedPanelTabsState(panelStateId, syncThreadId);
  return useCallback(() => {
    updateState(openFixedSecondaryPanelState);
  }, [updateState]);
}

export function useActiveFixedRightTerminalId(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): string | null {
  const state = useFixedPanelTabsState(panelStateId, syncThreadId);
  return findActiveTerminalTab(state)?.terminalId ?? null;
}

export function useSetFixedRightTerminalActiveTerminal(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): FixedPanelTerminalIdSetter {
  const updateState = useUpdateFixedPanelTabsState(panelStateId, syncThreadId);
  return useCallback(
    (terminalId: string | null) => {
      updateState((current) => {
        if (terminalId === null) {
          const activeTerminalTab = findActiveTerminalTab(current);
          if (activeTerminalTab === null) {
            return current;
          }
          return {
            ...current,
            secondary: {
              ...current.secondary,
              activeTabId: null,
            },
          };
        }

        const tabs = upsertTerminalTab(current.secondary.tabs, terminalId);
        const activeTabId = createTerminalFixedPanelTab({ terminalId }).id;
        if (
          tabs === current.secondary.tabs &&
          current.secondary.activeTabId === activeTabId &&
          current.secondary.isOpen
        ) {
          return current;
        }
        return {
          ...current,
          secondary: {
            tabs,
            activeTabId,
            isOpen: true,
          },
        };
      });
    },
    [updateState],
  );
}

export function useRemoveFixedRightTerminalTab(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): FixedPanelTerminalIdRemover {
  const updateState = useUpdateFixedPanelTabsState(panelStateId, syncThreadId);
  return useCallback(
    (terminalId: string) => {
      updateState((current) => {
        const tabs = removeTerminalTab(current.secondary.tabs, terminalId);
        if (tabs === current.secondary.tabs) {
          return current;
        }
        const removedActiveTabId =
          current.secondary.activeTabId ===
          createTerminalFixedPanelTab({ terminalId }).id;
        return {
          ...current,
          secondary: {
            ...current.secondary,
            tabs,
            activeTabId: removedActiveTabId
              ? null
              : current.secondary.activeTabId,
          },
        };
      });
    },
    [updateState],
  );
}
