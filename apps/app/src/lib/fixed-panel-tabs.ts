import { useCallback, useEffect, useRef } from "react";
import { atom } from "jotai";
import { useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { createLocalStorageSyncStorage } from "./browser-storage";
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

const FIXED_PANEL_TABS_TOUCH_THROTTLE_MS = 60 * 1000;

type FixedPanelTabsThreadId = string | null | undefined;

export type FixedPanelTabsStateUpdater = (
  state: FixedPanelTabsState,
) => FixedPanelTabsState;

interface LastFixedPanelTabsTouch {
  threadId: FixedPanelTabsThreadId;
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
  threadId: FixedPanelTabsThreadId,
): void {
  useEffect(() => {
    const now = Date.now();
    pruneFixedPanelTabsStorage({ now });
  }, [threadId]);
}

export function useFixedPanelTabsState(
  threadId: string | null | undefined,
): FixedPanelTabsState {
  return useAtomValue(getFixedPanelTabsStateAtom(threadId));
}

export function useUpdateFixedPanelTabsState(
  threadId: string | null | undefined,
): (update: FixedPanelTabsStateUpdater) => void {
  const setState = useSetAtom(getFixedPanelTabsStateAtom(threadId));
  return useCallback(
    (update: FixedPanelTabsStateUpdater) => {
      if (!hasThreadId(threadId)) return;
      const now = Date.now();
      setState((current) => {
        const next = update(current);
        if (next === current) {
          return current;
        }
        return touchFixedPanelTabsState(next, now);
      });
    },
    [setState, threadId],
  );
}

export function useTouchFixedPanelTabsState(
  threadId: string | null | undefined,
): () => void {
  const updateState = useUpdateFixedPanelTabsState(threadId);
  const lastTouchRef = useRef<LastFixedPanelTabsTouch | null>(null);
  return useCallback(() => {
    const now = Date.now();
    if (
      lastTouchRef.current !== null &&
      lastTouchRef.current.threadId === threadId &&
      now - lastTouchRef.current.touchedAt < FIXED_PANEL_TABS_TOUCH_THROTTLE_MS
    ) {
      return;
    }
    lastTouchRef.current = {
      threadId,
      touchedAt: now,
    };
    updateState((current) => {
      if (
        !current.secondary.isOpen &&
        current.secondary.tabs.length === 0
      ) {
        return current;
      }
      if (now - current.lastUsedAt < FIXED_PANEL_TABS_TOUCH_THROTTLE_MS) {
        return current;
      }
      return { ...current };
    });
  }, [threadId, updateState]);
}

export function useSetFixedSecondaryPanelTab(
  threadId: string | null | undefined,
): FixedPanelSecondaryPanelSetter {
  const updateState = useUpdateFixedPanelTabsState(threadId);
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
  threadId: string | null | undefined,
): FixedPanelSecondaryPanelCloser {
  const updateState = useUpdateFixedPanelTabsState(threadId);
  return useCallback(() => {
    updateState(closeFixedSecondaryPanelState);
  }, [updateState]);
}

export function useOpenFixedSecondaryPanel(
  threadId: FixedPanelTabsThreadId,
): FixedPanelSecondaryPanelOpener {
  const updateState = useUpdateFixedPanelTabsState(threadId);
  return useCallback(() => {
    updateState(openFixedSecondaryPanelState);
  }, [updateState]);
}

export function useActiveFixedRightTerminalId(
  threadId: string | null | undefined,
): string | null {
  const state = useFixedPanelTabsState(threadId);
  return findActiveTerminalTab(state)?.terminalId ?? null;
}

export function useSetFixedRightTerminalActiveTerminal(
  threadId: string | null | undefined,
): FixedPanelTerminalIdSetter {
  const updateState = useUpdateFixedPanelTabsState(threadId);
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
  threadId: string | null | undefined,
): FixedPanelTerminalIdRemover {
  const updateState = useUpdateFixedPanelTabsState(threadId);
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
