import { useCallback, useEffect, useMemo } from "react";
import type { ThreadType } from "@bb/domain";
import {
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  areFixedPanelTabsEquivalent,
  createAppFixedPanelTab,
  createBrowserFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type AppFixedPanelTab,
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
  areEnvironmentFilePreviewSourcesEqual,
  type HostFileTabState,
  type WorkspaceFileTabState,
} from "@/lib/file-preview";
import { useRecordThreadRecentItem } from "./threadRecentItems";

export const STATUS_APP_ID = "status";

interface ThreadAppTabDescriptor {
  id: string;
}

interface UseThreadFileTabsParams {
  apps?: readonly ThreadAppTabDescriptor[] | undefined;
  threadId: string | null | undefined;
  environmentId: string | null | undefined;
  threadType: ThreadType | undefined;
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

export interface FileSearchWorkspaceSelection {
  source: "workspace";
  path: string;
}

export interface FileSearchThreadStorageSelection {
  source: "thread-storage";
  path: string;
}

export interface FileSearchAppSelection {
  source: "app";
  appId: string;
}

export type FileSearchSelection =
  | FileSearchWorkspaceSelection
  | FileSearchThreadStorageSelection
  | FileSearchAppSelection;

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

function isAppTab(tab: FixedPanelTab): tab is AppFixedPanelTab {
  return tab.kind === "app";
}

function isBrowserTab(tab: FixedPanelTab): tab is BrowserFixedPanelTab {
  return tab.kind === "browser";
}

function isNewTab(tab: FixedPanelTab): tab is NewTabFixedPanelTab {
  return tab.kind === "new-tab";
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

function removeStorageTabs(
  tabs: readonly FixedPanelTab[],
): readonly FixedPanelTab[] {
  const nextTabs = tabs.filter((tab) => !isStorageFilePreviewTab(tab));
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

function pruneAppTabs(
  tabs: readonly FixedPanelTab[],
  knownAppIds: ReadonlySet<string>,
): readonly FixedPanelTab[] {
  const nextTabs = tabs.filter(
    (tab) => !isAppTab(tab) || knownAppIds.has(tab.appId),
  );
  return nextTabs.length === tabs.length ? tabs : nextTabs;
}

function isActiveTabStillOpen(
  tabs: readonly FixedPanelTab[],
  activeTabId: string | null,
): boolean {
  return activeTabId !== null && tabs.some((tab) => tab.id === activeTabId);
}

function createStorageTab(path: string): ThreadStorageFilePreviewFixedPanelTab {
  return createThreadStorageFilePreviewFixedPanelTab({
    isPinned: false,
    path,
  });
}

function createAppTab(appId: string): AppFixedPanelTab {
  return createAppFixedPanelTab({ appId });
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

function findAppTab(
  tabs: readonly FixedPanelTab[],
  appId: string,
): AppFixedPanelTab | null {
  for (const tab of tabs) {
    if (isAppTab(tab) && tab.appId === appId) {
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
  isManagerThread: boolean;
}

function isPinnedAppTab(tab: SecondaryFileFixedPanelTab): boolean {
  return tab.kind === "app" && tab.appId === STATUS_APP_ID;
}

function isPinnedSecondaryFileTab(tab: SecondaryFileFixedPanelTab): boolean {
  return isPinnedAppTab(tab);
}

/**
 * Flattens the secondary panel's tabs into the closable file-tab strip, in the
 * order the user opened them. The pinned manager status app is floated to the
 * front; everything else (workspace, host, storage, new tab) keeps its
 * insertion order regardless of type.
 */
function buildOrderedSecondaryFileTabs({
  tabs,
  resolvedEnvironmentId,
  isManagerThread,
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
      case "app":
      case "browser":
      case "new-tab":
        displayable.push(tab);
        break;
      case "thread-storage-file-preview":
        if (isManagerThread) {
          displayable.push(tab);
        }
        break;
      case "thread-info":
      case "git-diff":
      case "terminal":
        break;
    }
  }
  return [
    ...displayable.filter(isPinnedSecondaryFileTab),
    ...displayable.filter((tab) => !isPinnedSecondaryFileTab(tab)),
  ];
}

/**
 * Opens (or re-activates) an app tab in a thread's secondary panel and reveals
 * the panel. Keyed by `threadId`, so callers outside the active thread detail
 * view — e.g. the sidebar app-icon cluster — can drive the same panel state the
 * detail view reads. This is the canonical open-app-tab path; `useThreadFileTabs`
 * exposes it as `openApp`.
 */
export function useOpenThreadAppTab(
  threadId: string | null | undefined,
): (appId: string) => void {
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(threadId);
  return useCallback(
    (appId: string) => {
      const nextTab = createAppTab(appId);
      updateFixedPanelTabsState((state) => {
        const tabs = upsertSecondaryTab(state.secondary.tabs, nextTab);
        if (
          tabs === state.secondary.tabs &&
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
    [updateFixedPanelTabsState],
  );
}

export function useThreadFileTabs({
  apps,
  threadId,
  environmentId,
  threadType,
  storageFiles,
}: UseThreadFileTabsParams) {
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(threadId);
  const recordRecentItem = useRecordThreadRecentItem(threadId);
  const isThreadResolved = threadType !== undefined;
  const isManagerThread = threadType === "manager";
  const resolvedEnvironmentId = isThreadResolved
    ? (environmentId ?? null)
    : undefined;
  const appIds = useMemo(
    () => (apps ? new Set(apps.map((app) => app.id)) : null),
    [apps],
  );

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
    if (!isThreadResolved) return;
    if (isManagerThread) {
      return;
    }
    updateFixedPanelTabsState((state) => {
      const tabs = removeStorageTabs(state.secondary.tabs);
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
  }, [isManagerThread, isThreadResolved, updateFixedPanelTabsState]);

  useEffect(() => {
    if (!isThreadResolved || !storageFiles) return;
    if (!isManagerThread) return;
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
    isManagerThread,
    isThreadResolved,
    storageFiles,
    updateFixedPanelTabsState,
  ]);

  useEffect(() => {
    if (!isThreadResolved || appIds === null) return;
    updateFixedPanelTabsState((state) => {
      const tabs = pruneAppTabs(state.secondary.tabs, appIds);
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
  }, [appIds, isThreadResolved, updateFixedPanelTabsState]);

  useEffect(() => {
    if (!isManagerThread || appIds === null || !appIds.has(STATUS_APP_ID)) {
      return;
    }
    updateFixedPanelTabsState((state) => {
      const statusAppTab = createAppTab(STATUS_APP_ID);
      const tabs = upsertSecondaryTab(state.secondary.tabs, statusAppTab);
      const activeTabId = isActiveTabStillOpen(
        tabs,
        state.secondary.activeTabId,
      )
        ? state.secondary.activeTabId
        : statusAppTab.id;
      return setSecondaryTabs({
        activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs,
      });
    });
  }, [appIds, isManagerThread, updateFixedPanelTabsState]);

  const openWorkspaceFile = useCallback(
    ({ lineNumber, path, source, statusLabel }: WorkspaceFileTabState) => {
      if (resolvedEnvironmentId === undefined) return;
      // Only working-tree opens are recorded as recent: a recent row reopens the
      // live file, so diff-only previews (head/merge-base) would reopen to the
      // wrong content.
      if (source.kind === "working-tree") {
        recordRecentItem({ source: "workspace", path });
      }
      const nextTab = createWorkspaceFilePreviewFixedPanelTab({
        environmentId: resolvedEnvironmentId,
        tab: {
          lineNumber,
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
          existingTab.lineNumber === lineNumber &&
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
    [recordRecentItem, resolvedEnvironmentId, updateFixedPanelTabsState],
  );

  const closeWorkspaceFileTab = useCallback(
    (path: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findWorkspaceTab(state.secondary.tabs, path);
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
      });
    },
    [updateFixedPanelTabsState],
  );

  const activateWorkspaceFileTab = useCallback(
    (path: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findWorkspaceTab(state.secondary.tabs, path);
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
      });
    },
    [updateFixedPanelTabsState],
  );

  const openStorageFile = useCallback(
    (path: string) => {
      if (!isManagerThread) return;
      recordRecentItem({ source: "thread-storage", path });
      const nextTab = createStorageTab(path);
      updateFixedPanelTabsState((state) => {
        const tabs = upsertSecondaryTab(state.secondary.tabs, nextTab);
        if (
          tabs === state.secondary.tabs &&
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
    [isManagerThread, recordRecentItem, updateFixedPanelTabsState],
  );

  const openHostFile = useCallback(
    ({ lineNumber, path }: HostFileTabState) => {
      if (!threadId) return;
      const nextTab = createHostFilePreviewFixedPanelTab({
        lineNumber,
        path,
      });
      updateFixedPanelTabsState((state) => {
        const existingTab = findHostFileTab(state.secondary.tabs, path);
        const tabs = upsertSecondaryTab(state.secondary.tabs, nextTab);
        if (
          existingTab &&
          existingTab.lineNumber === lineNumber &&
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
    [threadId, updateFixedPanelTabsState],
  );

  const closeHostFileTab = useCallback(
    (path: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findHostFileTab(state.secondary.tabs, path);
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
      });
    },
    [updateFixedPanelTabsState],
  );

  const activateHostFileTab = useCallback(
    (path: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findHostFileTab(state.secondary.tabs, path);
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
      });
    },
    [updateFixedPanelTabsState],
  );

  const openApp = useOpenThreadAppTab(threadId);

  const closeAppTab = useCallback(
    (appId: string) => {
      if (appId === STATUS_APP_ID) return;
      updateFixedPanelTabsState((state) => {
        const tab = findAppTab(state.secondary.tabs, appId);
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
      });
    },
    [updateFixedPanelTabsState],
  );

  const activateAppTab = useCallback(
    (appId: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findAppTab(state.secondary.tabs, appId);
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
      });
    },
    [updateFixedPanelTabsState],
  );

  // Opening a browser tab swaps the transient new-tab in place (like selecting
  // an app); if there is no new-tab — e.g. a popup opened from another browser
  // tab — `replaceNewTab` appends it instead. `url` is empty for the new-tab
  // screen and set for popups.
  const openBrowserTab = useCallback(
    (url?: string) => {
      const nextTab = createBrowserFixedPanelTab({ url: url ?? "" });
      updateFixedPanelTabsState((state) => replaceNewTab({ nextTab, state }));
    },
    [updateFixedPanelTabsState],
  );

  const activateBrowserTab = useCallback(
    (tabId: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findBrowserTab(state.secondary.tabs, tabId);
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
      });
    },
    [updateFixedPanelTabsState],
  );

  const closeBrowserTab = useCallback(
    (tabId: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findBrowserTab(state.secondary.tabs, tabId);
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
      });
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
      if (!isManagerThread) return;
      updateFixedPanelTabsState((state) => {
        const tab = findStorageFileTab(state.secondary.tabs, path);
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
      });
    },
    [isManagerThread, updateFixedPanelTabsState],
  );

  const activateStorageFileTab = useCallback(
    (path: string) => {
      if (!isManagerThread) return;
      updateFixedPanelTabsState((state) => {
        const tab = findStorageFileTab(state.secondary.tabs, path);
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
      });
    },
    [isManagerThread, updateFixedPanelTabsState],
  );

  const openNewTab = useCallback(() => {
    const newTab = createNewTabFixedPanelTab();
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
  }, [updateFixedPanelTabsState]);

  const activateNewTab = useCallback(() => {
    const newTab = createNewTabFixedPanelTab();
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
  }, [updateFixedPanelTabsState]);

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
      if (selection.source === "app") {
        const nextTab = createAppTab(selection.appId);
        updateFixedPanelTabsState((state) => replaceNewTab({ nextTab, state }));
        return;
      }

      if (selection.source === "workspace") {
        if (resolvedEnvironmentId === undefined) return;
        recordRecentItem({ source: "workspace", path: selection.path });
        const nextTab = createWorkspaceFilePreviewFixedPanelTab({
          environmentId: resolvedEnvironmentId,
          tab: {
            lineNumber: null,
            path: selection.path,
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        });
        updateFixedPanelTabsState((state) => replaceNewTab({ nextTab, state }));
        return;
      }

      if (!isManagerThread) return;
      recordRecentItem({ source: "thread-storage", path: selection.path });
      const nextTab = createStorageTab(selection.path);
      updateFixedPanelTabsState((state) => replaceNewTab({ nextTab, state }));
    },
    [
      isManagerThread,
      recordRecentItem,
      resolvedEnvironmentId,
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
          activeTab.kind !== "app" &&
          activeTab.kind !== "browser")
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

  const activeTab = getActiveSecondaryTab(fixedPanelTabsState);
  const orderedSecondaryFileTabs = buildOrderedSecondaryFileTabs({
    tabs: fixedPanelTabsState.secondary.tabs,
    resolvedEnvironmentId,
    isManagerThread,
  });
  const activeWorkspaceFileTab =
    activeTab?.kind === "workspace-file-preview" &&
    activeTab.environmentId === resolvedEnvironmentId
      ? activeTab
      : null;
  const activeStorageFileTab =
    isManagerThread && activeTab?.kind === "thread-storage-file-preview"
      ? activeTab
      : null;
  const activeHostFileTab =
    activeTab?.kind === "host-file-preview" ? activeTab : null;
  const activeAppTab = activeTab?.kind === "app" ? activeTab : null;
  const activeBrowserTab = activeTab?.kind === "browser" ? activeTab : null;
  const activeNewTab = activeTab?.kind === "new-tab" ? activeTab : null;

  return {
    orderedSecondaryFileTabs,
    activateAppTab,
    activateBrowserTab,
    activateNewTab,
    activateHostFileTab,
    activateStorageFileTab,
    activateWorkspaceFileTab,
    activeAppId: activeAppTab?.appId ?? null,
    activeBrowserTab,
    activeHostFileLineNumber: activeHostFileTab?.lineNumber ?? null,
    activeHostFilePath: activeHostFileTab?.path ?? null,
    activeStorageFilePath: activeStorageFileTab?.path ?? null,
    activeWorkspaceFileLineNumber: activeWorkspaceFileTab?.lineNumber ?? null,
    activeWorkspaceFilePath: activeWorkspaceFileTab?.path ?? null,
    activeWorkspaceFileSource: activeWorkspaceFileTab?.source ?? null,
    activeWorkspaceFileStatusLabel: activeWorkspaceFileTab?.statusLabel ?? null,
    clearActiveFileTabs,
    closeAppTab,
    closeBrowserTab,
    closeHostFileTab,
    closeNewTab,
    closeStorageFileTab,
    closeWorkspaceFileTab,
    hasNewTab: findNewTab(fixedPanelTabsState.secondary.tabs) !== null,
    isNewTabActive: activeNewTab !== null,
    openBrowserTab,
    openNewTab,
    openApp,
    openHostFile,
    openStorageFile,
    openWorkspaceFile,
    selectFileSearchResult,
    updateBrowserTab,
  };
}
