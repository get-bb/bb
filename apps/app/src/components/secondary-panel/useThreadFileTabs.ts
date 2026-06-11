import { useCallback, useEffect, useMemo } from "react";
import { useSetAtom } from "jotai";
import { arrayMove } from "@dnd-kit/sortable";
import {
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  areFixedPanelTabsEquivalent,
  createBrowserFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type BrowserFixedPanelTab,
  type FixedPanelTab,
  type FixedPanelTabsState,
  type HostFilePreviewFixedPanelTab,
  type NewTabFixedPanelTab,
  type SecondaryFileFixedPanelTab,
  type ThreadStorageFilePreviewFixedPanelTab,
  type WorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  areFilePreviewLineRangesEqual,
  areEnvironmentFilePreviewSourcesEqual,
  type HostFileTabState,
  type ThreadStorageFileTabState,
  type WorkspaceFileTabState,
} from "@/lib/file-preview";
import { getThreadSecondaryPanelOpenAtom } from "./threadSecondaryPanelAtoms";
import { useRecordThreadRecentItem } from "./threadRecentItems";
import type {
  SecondaryPanelTabReorderHandler,
  SecondaryPanelTabReorderRequest,
} from "./secondaryPanelFileTab";

interface UseThreadFileTabsParams {
  threadId: string | null | undefined;
  environmentId: string | null | undefined;
  storageFiles: readonly { path: string }[] | undefined;
}

interface SetSecondaryTabsArgs {
  activeTabId: string | null;
  isOpen: boolean;
  state: FixedPanelTabsState;
  tabs: readonly FixedPanelTab[];
}

interface ReplaceNewTabArgs {
  nextTab: FixedPanelTab;
  state: FixedPanelTabsState;
}

interface ReorderSecondaryFileTabStateArgs
  extends SecondaryPanelTabReorderRequest {
  state: FixedPanelTabsState;
}

export interface FileSearchWorkspaceSelection {
  source: "workspace";
  path: string;
}

export interface FileSearchThreadStorageSelection {
  source: "thread-storage";
  path: string;
}

export type FileSearchSelection =
  | FileSearchWorkspaceSelection
  | FileSearchThreadStorageSelection;

export interface UpdateBrowserTabArgs {
  tabId: string;
  url: string;
  title: string | null;
}

function isWorkspaceFilePreviewTab(
  tab: FixedPanelTab,
): tab is WorkspaceFilePreviewFixedPanelTab {
  return tab.kind === "workspace-file-preview";
}

function isHostFilePreviewTab(
  tab: FixedPanelTab,
): tab is HostFilePreviewFixedPanelTab {
  return tab.kind === "host-file-preview";
}

function isStorageFilePreviewTab(
  tab: FixedPanelTab,
): tab is ThreadStorageFilePreviewFixedPanelTab {
  return tab.kind === "thread-storage-file-preview";
}

function isBrowserTab(tab: FixedPanelTab): tab is BrowserFixedPanelTab {
  return tab.kind === "browser";
}

function isNewTab(tab: FixedPanelTab): tab is NewTabFixedPanelTab {
  return tab.kind === "new-tab";
}

function isSecondaryFileTab(tab: FixedPanelTab): tab is SecondaryFileFixedPanelTab {
  switch (tab.kind) {
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
    case "browser":
    case "terminal":
    case "new-tab":
      return true;
    case "thread-info":
    case "git-diff":
      return false;
  }
}

function getActiveSecondaryTab(
  state: FixedPanelTabsState,
): FixedPanelTab | null {
  const activeTabId = state.secondary.activeTabId;
  if (activeTabId === null) {
    return null;
  }
  return state.secondary.tabs.find((tab) => tab.id === activeTabId) ?? null;
}

function setSecondaryTabs({
  activeTabId,
  isOpen,
  state,
  tabs,
}: SetSecondaryTabsArgs): FixedPanelTabsState {
  if (
    tabs === state.secondary.tabs &&
    activeTabId === state.secondary.activeTabId &&
    isOpen === state.secondary.isOpen
  ) {
    return state;
  }

  return {
    ...state,
    secondary: {
      tabs,
      activeTabId,
      isOpen,
    },
  };
}

function upsertSecondaryTab(
  tabs: readonly FixedPanelTab[],
  nextTab: FixedPanelTab,
): readonly FixedPanelTab[] {
  const existingTabIndex = tabs.findIndex((tab) => tab.id === nextTab.id);
  if (existingTabIndex === -1) {
    return [...tabs, nextTab];
  }

  const existingTab = tabs[existingTabIndex];
  if (existingTab && areFixedPanelTabsEquivalent(existingTab, nextTab)) {
    return tabs;
  }

  return tabs.map((tab) => (tab.id === nextTab.id ? nextTab : tab));
}

function removeSecondaryTab(
  tabs: readonly FixedPanelTab[],
  tabId: string,
): readonly FixedPanelTab[] {
  const nextTabs = tabs.filter((tab) => tab.id !== tabId);
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

function reorderSecondaryFileTabInState({
  activeTabId,
  overTabId,
  state,
}: ReorderSecondaryFileTabStateArgs): FixedPanelTabsState {
  if (activeTabId === overTabId) {
    return state;
  }
  const activeIndex = state.secondary.tabs.findIndex(
    (tab) => tab.id === activeTabId && isSecondaryFileTab(tab),
  );
  const overIndex = state.secondary.tabs.findIndex(
    (tab) => tab.id === overTabId && isSecondaryFileTab(tab),
  );
  if (activeIndex === -1 || overIndex === -1) {
    return state;
  }
  return setSecondaryTabs({
    activeTabId: state.secondary.activeTabId,
    isOpen: state.secondary.isOpen,
    state,
    tabs: arrayMove([...state.secondary.tabs], activeIndex, overIndex),
  });
}

function removeWorkspaceTabsForOtherEnvironments(
  tabs: readonly FixedPanelTab[],
  environmentId: string | null,
): readonly FixedPanelTab[] {
  const nextTabs = tabs.filter(
    (tab) =>
      !isWorkspaceFilePreviewTab(tab) || tab.environmentId === environmentId,
  );
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

function pruneStorageTabs(
  tabs: readonly FixedPanelTab[],
  knownPaths: ReadonlySet<string>,
): readonly FixedPanelTab[] {
  const nextTabs = tabs.filter(
    (tab) => !isStorageFilePreviewTab(tab) || knownPaths.has(tab.path),
  );
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

function isActiveTabStillOpen(
  tabs: readonly FixedPanelTab[],
  activeTabId: string | null,
): boolean {
  return activeTabId !== null && tabs.some((tab) => tab.id === activeTabId);
}

function removeTabFromState(
  state: FixedPanelTabsState,
  tab: FixedPanelTab | null,
): FixedPanelTabsState {
  if (!tab) {
    return state;
  }
  const tabs = removeSecondaryTab(state.secondary.tabs, tab.id);
  return setSecondaryTabs({
    activeTabId:
      state.secondary.activeTabId === tab.id
        ? null
        : state.secondary.activeTabId,
    isOpen: state.secondary.isOpen,
    state,
    tabs,
  });
}

function activateTabInState(
  state: FixedPanelTabsState,
  tab: FixedPanelTab | null,
): FixedPanelTabsState {
  if (!tab) {
    return state;
  }
  if (state.secondary.activeTabId === tab.id && state.secondary.isOpen) {
    return state;
  }
  return setSecondaryTabs({
    activeTabId: tab.id,
    isOpen: true,
    state,
    tabs: state.secondary.tabs,
  });
}

function createStorageTab(
  tab: ThreadStorageFileTabState,
): ThreadStorageFilePreviewFixedPanelTab {
  return createThreadStorageFilePreviewFixedPanelTab({
    isPinned: false,
    tab,
  });
}

function findWorkspaceTab(
  tabs: readonly FixedPanelTab[],
  path: string,
): WorkspaceFilePreviewFixedPanelTab | null {
  for (const tab of tabs) {
    if (isWorkspaceFilePreviewTab(tab) && tab.path === path) {
      return tab;
    }
  }
  return null;
}

function findHostFileTab(
  tabs: readonly FixedPanelTab[],
  path: string,
): HostFilePreviewFixedPanelTab | null {
  for (const tab of tabs) {
    if (isHostFilePreviewTab(tab) && tab.path === path) {
      return tab;
    }
  }
  return null;
}

function findStorageFileTab(
  tabs: readonly FixedPanelTab[],
  path: string,
): ThreadStorageFilePreviewFixedPanelTab | null {
  for (const tab of tabs) {
    if (isStorageFilePreviewTab(tab) && tab.path === path) {
      return tab;
    }
  }
  return null;
}

function findBrowserTab(
  tabs: readonly FixedPanelTab[],
  tabId: string,
): BrowserFixedPanelTab | null {
  for (const tab of tabs) {
    if (isBrowserTab(tab) && tab.id === tabId) {
      return tab;
    }
  }
  return null;
}

function findNewTab(
  tabs: readonly FixedPanelTab[],
): NewTabFixedPanelTab | null {
  for (const tab of tabs) {
    if (isNewTab(tab)) {
      return tab;
    }
  }
  return null;
}

function replaceNewTab({
  nextTab,
  state,
}: ReplaceNewTabArgs): FixedPanelTabsState {
  const newTab = findNewTab(state.secondary.tabs);
  const tabsWithoutNewTab =
    newTab === null
      ? state.secondary.tabs
      : removeSecondaryTab(state.secondary.tabs, newTab.id);
  const existingPreviewTab = tabsWithoutNewTab.find(
    (tab) => tab.id === nextTab.id,
  );

  if (existingPreviewTab) {
    return setSecondaryTabs({
      activeTabId: existingPreviewTab.id,
      isOpen: true,
      state,
      tabs: tabsWithoutNewTab,
    });
  }

  const tabs =
    newTab === null
      ? upsertSecondaryTab(tabsWithoutNewTab, nextTab)
      : state.secondary.tabs.map((tab) =>
          tab.id === newTab.id ? nextTab : tab,
        );

  return setSecondaryTabs({
    activeTabId: nextTab.id,
    isOpen: true,
    state,
    tabs,
  });
}

interface BuildOrderedSecondaryFileTabsArgs {
  tabs: readonly FixedPanelTab[];
  resolvedEnvironmentId: string | null | undefined;
}

/**
 * Flattens the secondary panel's tabs into the closable file-tab strip, in the
 * order the user opened them. Workspace, host, storage, browser,
 * terminal, and new tabs keep their insertion order regardless of type.
 */
function buildOrderedSecondaryFileTabs({
  tabs,
  resolvedEnvironmentId,
}: BuildOrderedSecondaryFileTabsArgs): readonly SecondaryFileFixedPanelTab[] {
  const displayable: SecondaryFileFixedPanelTab[] = [];
  for (const tab of tabs) {
    switch (tab.kind) {
      case "workspace-file-preview":
        if (
          resolvedEnvironmentId !== undefined &&
          tab.environmentId === resolvedEnvironmentId
        ) {
          displayable.push(tab);
        }
        break;
      case "host-file-preview":
      case "browser":
      case "terminal":
      case "new-tab":
        displayable.push(tab);
        break;
      case "thread-storage-file-preview":
        displayable.push(tab);
        break;
      case "thread-info":
      case "git-diff":
        break;
    }
  }
  return displayable;
}

export function useThreadFileTabs({
  threadId,
  environmentId,
  storageFiles,
}: UseThreadFileTabsParams) {
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(threadId);
  const setThreadSecondaryPanelOpen = useSetAtom(
    getThreadSecondaryPanelOpenAtom(threadId),
  );
  const recordRecentItem = useRecordThreadRecentItem(threadId);
  const isThreadResolved = threadId !== null && threadId !== undefined;
  const resolvedEnvironmentId = isThreadResolved ? environmentId : undefined;

  useEffect(() => {
    if (resolvedEnvironmentId === undefined) return;
    updateFixedPanelTabsState((state) => {
      const tabs = removeWorkspaceTabsForOtherEnvironments(
        state.secondary.tabs,
        resolvedEnvironmentId,
      );
      const activeTabId = isActiveTabStillOpen(
        tabs,
        state.secondary.activeTabId,
      )
        ? state.secondary.activeTabId
        : null;
      return setSecondaryTabs({
        activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs,
      });
    });
  }, [resolvedEnvironmentId, updateFixedPanelTabsState]);

  useEffect(() => {
    if (!isThreadResolved || !storageFiles) return;
    updateFixedPanelTabsState((state) => {
      const knownPaths = new Set(storageFiles.map((file) => file.path));
      const tabs = pruneStorageTabs(state.secondary.tabs, knownPaths);
      const activeTabId = isActiveTabStillOpen(
        tabs,
        state.secondary.activeTabId,
      )
        ? state.secondary.activeTabId
        : null;
      return setSecondaryTabs({
        activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs,
      });
    });
  }, [
    isThreadResolved,
    storageFiles,
    updateFixedPanelTabsState,
  ]);

  const openWorkspaceFile = useCallback(
    ({ lineRange, path, source, statusLabel }: WorkspaceFileTabState) => {
      if (resolvedEnvironmentId === undefined) return;
      setThreadSecondaryPanelOpen(true);
      // Only working-tree opens are recorded as recent: a recent row reopens the
      // live file, so diff-only previews (head/merge-base) would reopen to the
      // wrong content.
      if (source.kind === "working-tree") {
        recordRecentItem({ source: "workspace", path });
      }
      const nextTab = createWorkspaceFilePreviewFixedPanelTab({
        environmentId: resolvedEnvironmentId,
        tab: {
          lineRange,
          path,
          source,
          statusLabel,
        },
      });
      updateFixedPanelTabsState((state) => {
        const existingTab = findWorkspaceTab(state.secondary.tabs, path);
        const tabs = upsertSecondaryTab(state.secondary.tabs, nextTab);
        if (
          existingTab &&
          existingTab.environmentId === resolvedEnvironmentId &&
          areFilePreviewLineRangesEqual({
            a: existingTab.lineRange,
            b: lineRange,
          }) &&
          areEnvironmentFilePreviewSourcesEqual(existingTab.source, source) &&
          existingTab.statusLabel === statusLabel &&
          state.secondary.activeTabId === nextTab.id &&
          state.secondary.isOpen
        ) {
          return state;
        }
        return setSecondaryTabs({
          activeTabId: nextTab.id,
          isOpen: true,
          state,
          tabs,
        });
      });
    },
    [
      recordRecentItem,
      resolvedEnvironmentId,
      setThreadSecondaryPanelOpen,
      updateFixedPanelTabsState,
    ],
  );

  const closeWorkspaceFileTab = useCallback(
    (path: string) => {
      updateFixedPanelTabsState((state) =>
        removeTabFromState(state, findWorkspaceTab(state.secondary.tabs, path)),
      );
    },
    [updateFixedPanelTabsState],
  );

  const activateWorkspaceFileTab = useCallback(
    (path: string) => {
      if (findWorkspaceTab(fixedPanelTabsState.secondary.tabs, path) === null) {
        return;
      }
      setThreadSecondaryPanelOpen(true);
      updateFixedPanelTabsState((state) =>
        activateTabInState(
          state,
          findWorkspaceTab(state.secondary.tabs, path),
        ),
      );
    },
    [
      fixedPanelTabsState.secondary.tabs,
      setThreadSecondaryPanelOpen,
      updateFixedPanelTabsState,
    ],
  );

  const openStorageFile = useCallback(
    ({ lineRange, path }: ThreadStorageFileTabState) => {
      setThreadSecondaryPanelOpen(true);
      recordRecentItem({ source: "thread-storage", path });
      const nextTab = createStorageTab({ lineRange, path });
      updateFixedPanelTabsState((state) => {
        const existingTab = findStorageFileTab(state.secondary.tabs, path);
        const tabs = upsertSecondaryTab(state.secondary.tabs, nextTab);
        if (
          existingTab &&
          areFilePreviewLineRangesEqual({
            a: existingTab.lineRange,
            b: lineRange,
          }) &&
          state.secondary.activeTabId === nextTab.id &&
          state.secondary.isOpen
        ) {
          return state;
        }
        return setSecondaryTabs({
          activeTabId: nextTab.id,
          isOpen: true,
          state,
          tabs,
        });
      });
    },
    [
      recordRecentItem,
      setThreadSecondaryPanelOpen,
      updateFixedPanelTabsState,
    ],
  );

  const openHostFile = useCallback(
    ({ lineRange, path }: HostFileTabState) => {
      if (!threadId) return;
      setThreadSecondaryPanelOpen(true);
      const nextTab = createHostFilePreviewFixedPanelTab({
        lineRange,
        path,
      });
      updateFixedPanelTabsState((state) => {
        const existingTab = findHostFileTab(state.secondary.tabs, path);
        const tabs = upsertSecondaryTab(state.secondary.tabs, nextTab);
        if (
          existingTab &&
          areFilePreviewLineRangesEqual({
            a: existingTab.lineRange,
            b: lineRange,
          }) &&
          state.secondary.activeTabId === nextTab.id &&
          state.secondary.isOpen
        ) {
          return state;
        }
        return setSecondaryTabs({
          activeTabId: nextTab.id,
          isOpen: true,
          state,
          tabs,
        });
      });
    },
    [setThreadSecondaryPanelOpen, threadId, updateFixedPanelTabsState],
  );

  const closeHostFileTab = useCallback(
    (path: string) => {
      updateFixedPanelTabsState((state) =>
        removeTabFromState(state, findHostFileTab(state.secondary.tabs, path)),
      );
    },
    [updateFixedPanelTabsState],
  );

  const activateHostFileTab = useCallback(
    (path: string) => {
      if (findHostFileTab(fixedPanelTabsState.secondary.tabs, path) === null) {
        return;
      }
      setThreadSecondaryPanelOpen(true);
      updateFixedPanelTabsState((state) =>
        activateTabInState(state, findHostFileTab(state.secondary.tabs, path)),
      );
    },
    [
      fixedPanelTabsState.secondary.tabs,
      setThreadSecondaryPanelOpen,
      updateFixedPanelTabsState,
    ],
  );

  // Opening a browser tab swaps the transient new-tab in place (like selecting
  // a file); if there is no new-tab — e.g. a popup opened from another browser
  // tab — `replaceNewTab` appends it instead. `url` is empty for the new-tab
  // screen and set for popups.
  const openBrowserTab = useCallback(
    (url?: string) => {
      const nextTab = createBrowserFixedPanelTab({ url: url ?? "" });
      setThreadSecondaryPanelOpen(true);
      updateFixedPanelTabsState((state) => replaceNewTab({ nextTab, state }));
    },
    [setThreadSecondaryPanelOpen, updateFixedPanelTabsState],
  );

  const activateBrowserTab = useCallback(
    (tabId: string) => {
      if (findBrowserTab(fixedPanelTabsState.secondary.tabs, tabId) === null) {
        return;
      }
      setThreadSecondaryPanelOpen(true);
      updateFixedPanelTabsState((state) =>
        activateTabInState(state, findBrowserTab(state.secondary.tabs, tabId)),
      );
    },
    [
      fixedPanelTabsState.secondary.tabs,
      setThreadSecondaryPanelOpen,
      updateFixedPanelTabsState,
    ],
  );

  const closeBrowserTab = useCallback(
    (tabId: string) => {
      updateFixedPanelTabsState((state) =>
        removeTabFromState(state, findBrowserTab(state.secondary.tabs, tabId)),
      );
    },
    [updateFixedPanelTabsState],
  );

  // Persist the URL/title/favicon pushed from the live view so the tab pill and
  // restore-on-reload stay current. `upsertSecondaryTab`'s equivalence check
  // makes an unchanged update a no-op (no re-render / re-write).
  const updateBrowserTab = useCallback(
    ({ tabId, url, title }: UpdateBrowserTabArgs) => {
      updateFixedPanelTabsState((state) => {
        const tab = findBrowserTab(state.secondary.tabs, tabId);
        if (!tab) {
          return state;
        }
        const nextTab: BrowserFixedPanelTab = {
          ...tab,
          title,
          url,
        };
        const tabs = upsertSecondaryTab(state.secondary.tabs, nextTab);
        if (tabs === state.secondary.tabs) {
          return state;
        }
        return setSecondaryTabs({
          activeTabId: state.secondary.activeTabId,
          isOpen: state.secondary.isOpen,
          state,
          tabs,
        });
      });
    },
    [updateFixedPanelTabsState],
  );

  const closeStorageFileTab = useCallback(
    (path: string) => {
      updateFixedPanelTabsState((state) =>
        removeTabFromState(
          state,
          findStorageFileTab(state.secondary.tabs, path),
        ),
      );
    },
    [updateFixedPanelTabsState],
  );

  const activateStorageFileTab = useCallback(
    (path: string) => {
      if (findStorageFileTab(fixedPanelTabsState.secondary.tabs, path) === null) {
        return;
      }
      setThreadSecondaryPanelOpen(true);
      updateFixedPanelTabsState((state) =>
        activateTabInState(
          state,
          findStorageFileTab(state.secondary.tabs, path),
        ),
      );
    },
    [
      fixedPanelTabsState.secondary.tabs,
      setThreadSecondaryPanelOpen,
      updateFixedPanelTabsState,
    ],
  );

  const openNewTab = useCallback(() => {
    const newTab = createNewTabFixedPanelTab();
    setThreadSecondaryPanelOpen(true);
    updateFixedPanelTabsState((state) => {
      const tabs = upsertSecondaryTab(state.secondary.tabs, newTab);
      if (
        tabs === state.secondary.tabs &&
        state.secondary.activeTabId === newTab.id &&
        state.secondary.isOpen
      ) {
        return state;
      }
      return setSecondaryTabs({
        activeTabId: newTab.id,
        isOpen: true,
        state,
        tabs,
      });
    });
  }, [setThreadSecondaryPanelOpen, updateFixedPanelTabsState]);

  const activateNewTab = useCallback(() => {
    const newTab = createNewTabFixedPanelTab();
    if (findNewTab(fixedPanelTabsState.secondary.tabs) === null) {
      return;
    }
    setThreadSecondaryPanelOpen(true);
    updateFixedPanelTabsState((state) => {
      const existingTab = findNewTab(state.secondary.tabs);
      if (!existingTab) {
        return state;
      }
      if (state.secondary.activeTabId === newTab.id && state.secondary.isOpen) {
        return state;
      }
      return setSecondaryTabs({
        activeTabId: newTab.id,
        isOpen: true,
        state,
        tabs: state.secondary.tabs,
      });
    });
  }, [
    fixedPanelTabsState.secondary.tabs,
    setThreadSecondaryPanelOpen,
    updateFixedPanelTabsState,
  ]);

  const closeNewTab = useCallback(() => {
    const newTab = createNewTabFixedPanelTab();
    updateFixedPanelTabsState((state) => {
      const tabs = removeSecondaryTab(state.secondary.tabs, newTab.id);
      if (tabs === state.secondary.tabs) {
        return state;
      }
      return setSecondaryTabs({
        activeTabId:
          state.secondary.activeTabId === newTab.id
            ? null
            : state.secondary.activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs,
      });
    });
  }, [updateFixedPanelTabsState]);

  const selectFileSearchResult = useCallback(
    (selection: FileSearchSelection) => {
      if (selection.source === "workspace") {
        if (resolvedEnvironmentId === undefined) return;
        setThreadSecondaryPanelOpen(true);
        recordRecentItem({ source: "workspace", path: selection.path });
        const nextTab = createWorkspaceFilePreviewFixedPanelTab({
          environmentId: resolvedEnvironmentId,
          tab: {
            lineRange: null,
            path: selection.path,
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        });
        updateFixedPanelTabsState((state) => replaceNewTab({ nextTab, state }));
        return;
      }

      setThreadSecondaryPanelOpen(true);
      recordRecentItem({ source: "thread-storage", path: selection.path });
      const nextTab = createStorageTab({
        lineRange: null,
        path: selection.path,
      });
      updateFixedPanelTabsState((state) => replaceNewTab({ nextTab, state }));
    },
    [
      recordRecentItem,
      resolvedEnvironmentId,
      setThreadSecondaryPanelOpen,
      updateFixedPanelTabsState,
    ],
  );

  const clearActiveFileTabs = useCallback(() => {
    updateFixedPanelTabsState((state) => {
      const activeTab = getActiveSecondaryTab(state);
      if (
        !activeTab ||
        (activeTab.kind !== "workspace-file-preview" &&
          activeTab.kind !== "host-file-preview" &&
          activeTab.kind !== "thread-storage-file-preview" &&
          activeTab.kind !== "browser" &&
          activeTab.kind !== "terminal" &&
          activeTab.kind !== "new-tab")
      ) {
        return state;
      }
      return setSecondaryTabs({
        activeTabId: null,
        isOpen: state.secondary.isOpen,
        state,
        tabs: state.secondary.tabs,
      });
    });
  }, [updateFixedPanelTabsState]);

  const reorderFileTab = useCallback<SecondaryPanelTabReorderHandler>(
    (request) => {
      updateFixedPanelTabsState((state) =>
        reorderSecondaryFileTabInState({ ...request, state }),
      );
    },
    [updateFixedPanelTabsState],
  );

  const activeTab = getActiveSecondaryTab(fixedPanelTabsState);
  const orderedSecondaryFileTabs = buildOrderedSecondaryFileTabs({
    tabs: fixedPanelTabsState.secondary.tabs,
    resolvedEnvironmentId,
  });
  // Every open browser tab in insertion order. The secondary panel keeps a live
  // native view mounted for each one (only the active tab is shown), so the deck
  // must see them all — not just the active tab — to avoid destroying/recreating
  // a view on each tab switch.
  const browserTabs = useMemo(
    () => fixedPanelTabsState.secondary.tabs.filter(isBrowserTab),
    [fixedPanelTabsState.secondary.tabs],
  );
  const activeWorkspaceFileTab =
    activeTab?.kind === "workspace-file-preview" &&
    activeTab.environmentId === resolvedEnvironmentId
      ? activeTab
      : null;
  const activeStorageFileTab =
    activeTab?.kind === "thread-storage-file-preview"
      ? activeTab
      : null;
  const activeHostFileTab =
    activeTab?.kind === "host-file-preview" ? activeTab : null;
  const activeBrowserTab = activeTab?.kind === "browser" ? activeTab : null;
  const activeNewTab = activeTab?.kind === "new-tab" ? activeTab : null;

  return {
    orderedSecondaryFileTabs,
    activateBrowserTab,
    activateNewTab,
    activateHostFileTab,
    activateStorageFileTab,
    activateWorkspaceFileTab,
    activeBrowserTab,
    activeHostFileLineRange: activeHostFileTab?.lineRange ?? null,
    activeHostFilePath: activeHostFileTab?.path ?? null,
    activeStorageFileLineRange: activeStorageFileTab?.lineRange ?? null,
    activeStorageFilePath: activeStorageFileTab?.path ?? null,
    activeWorkspaceFileLineRange: activeWorkspaceFileTab?.lineRange ?? null,
    activeWorkspaceFilePath: activeWorkspaceFileTab?.path ?? null,
    activeWorkspaceFileSource: activeWorkspaceFileTab?.source ?? null,
    activeWorkspaceFileStatusLabel: activeWorkspaceFileTab?.statusLabel ?? null,
    browserTabs,
    clearActiveFileTabs,
    closeBrowserTab,
    closeHostFileTab,
    closeNewTab,
    closeStorageFileTab,
    closeWorkspaceFileTab,
    isNewTabActive: activeNewTab !== null,
    openBrowserTab,
    openNewTab,
    openHostFile,
    openStorageFile,
    openWorkspaceFile,
    reorderFileTab,
    selectFileSearchResult,
    updateBrowserTab,
  };
}
