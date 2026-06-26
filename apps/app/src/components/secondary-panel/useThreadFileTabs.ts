import { useCallback, useEffect, useMemo } from "react";
import type { TerminalSession } from "@bb/server-contract";
import {
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  createBrowserFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  createSideChatFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type BrowserFixedPanelTab,
  type FixedPanelTab,
  type HostFilePreviewFixedPanelTab,
  type NewTabFixedPanelTab,
  type SideChatFixedPanelTab,
  type ThreadStorageFilePreviewFixedPanelTab,
  type WorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type {
  HostFileTabState,
  ThreadStorageFileTabState,
  WorkspaceFileTabState,
} from "@/lib/file-preview";
import { useRecordThreadRecentItem } from "./threadRecentItems";
import type {
  SecondaryPanelTabReorderHandler,
  SecondaryPanelTabReorderRequest,
} from "./secondaryPanelFileTab";
import {
  activateSecondaryPanelTabInState,
  buildOrderedSecondaryPanelFileTabs,
  clearActiveSecondaryFileTabInState,
  closeSecondaryPanelTabInState,
  findSecondaryPanelTab,
  getActiveSecondaryPanelTab,
  getActiveTabIdAfterPrune,
  isBrowserTab,
  openSecondaryPanelTabInState,
  pruneStorageTabs,
  removeWorkspaceTabsForOtherEnvironments,
  replaceNewTabWithSecondaryPanelTabInState,
  reorderSecondaryPanelFileTabInState,
  setSecondaryPanelTabsInState,
  updateSecondaryPanelTabInState,
} from "./secondaryPanelTabState";
import { pruneTerminalTabsForSessions } from "./terminalPanelTabs";

interface UseThreadFileTabsParams {
  threadId: string | null | undefined;
  environmentId: string | null | undefined;
  fileOwnerThreadId?: string | null;
  preserveWorkspaceTabsAcrossContexts?: boolean;
  projectId?: string | null;
  retainedTerminalId?: string | null;
  storageFiles: readonly ThreadStorageFileListItem[] | undefined;
  terminalSessions: readonly TerminalSession[] | undefined;
}

interface ThreadStorageFileListItem {
  path: string;
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

export interface OpenSideChatArgs {
  replaceNewTab?: boolean;
  sourceThreadId: string;
  sourceMessageText: string;
  sourceSeqEnd?: number;
}

export interface SetSideChatThreadIdArgs {
  tabId: string;
  threadId: string;
}

export type OpenSecondaryPanelTabRequest =
  | { kind: "workspace-file-preview"; tab: WorkspaceFileTabState }
  | { kind: "host-file-preview"; tab: HostFileTabState }
  | { kind: "thread-storage-file-preview"; tab: ThreadStorageFileTabState }
  | { kind: "browser"; url: string }
  | { kind: "new-tab" };

interface CreateTabForOpenRequestArgs {
  projectId: string | null;
  request: OpenSecondaryPanelTabRequest;
  resolvedEnvironmentId: string | null | undefined;
  threadId: string | null | undefined;
}

interface CreateTabForFileSearchSelectionArgs {
  projectId: string | null;
  resolvedEnvironmentId: string | null | undefined;
  selection: FileSearchSelection;
  threadId: string | null | undefined;
}

interface PruneSecondaryTabsArgs {
  activeTabId: string | null;
  stateTabs: readonly FixedPanelTab[];
  tabs: readonly FixedPanelTab[];
}

type SecondaryPanelTab =
  | WorkspaceFilePreviewFixedPanelTab
  | HostFilePreviewFixedPanelTab
  | ThreadStorageFilePreviewFixedPanelTab
  | BrowserFixedPanelTab
  | NewTabFixedPanelTab;

function isSideChatTab(tab: FixedPanelTab): tab is SideChatFixedPanelTab {
  return tab.kind === "side-chat";
}

// Every side chat uses a constant tab title; the message it was triggered from
// is shown inside the panel ("Replying to" bubble), so the tab needn't echo it.
const SIDE_CHAT_TAB_TITLE = "Side chat";

function createStorageTab(
  environmentId: string | null,
  tab: ThreadStorageFileTabState,
  threadId: string,
): ThreadStorageFilePreviewFixedPanelTab {
  return createThreadStorageFilePreviewFixedPanelTab({
    environmentId,
    isPinned: false,
    tab,
    threadId,
  });
}

function createTabForOpenRequest({
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
}: CreateTabForOpenRequestArgs): SecondaryPanelTab | null {
  switch (request.kind) {
    case "workspace-file-preview":
      if (resolvedEnvironmentId === undefined) return null;
      return createWorkspaceFilePreviewFixedPanelTab({
        environmentId: resolvedEnvironmentId,
        projectId: resolvedEnvironmentId === null ? projectId : null,
        tab: request.tab,
      });
    case "host-file-preview":
      if (!threadId || !resolvedEnvironmentId) return null;
      return createHostFilePreviewFixedPanelTab({
        environmentId: resolvedEnvironmentId,
        tab: request.tab,
        threadId,
      });
    case "thread-storage-file-preview":
      if (!threadId) return null;
      return createStorageTab(
        resolvedEnvironmentId ?? null,
        request.tab,
        threadId,
      );
    case "browser":
      return createBrowserFixedPanelTab({
        environmentId: resolvedEnvironmentId ?? null,
        url: request.url,
      });
    case "new-tab":
      return createNewTabFixedPanelTab();
  }
}

function createTabForFileSearchSelection({
  projectId,
  resolvedEnvironmentId,
  selection,
  threadId,
}: CreateTabForFileSearchSelectionArgs):
  | WorkspaceFilePreviewFixedPanelTab
  | ThreadStorageFilePreviewFixedPanelTab
  | null {
  if (selection.source === "workspace") {
    if (resolvedEnvironmentId === undefined) return null;
    return createWorkspaceFilePreviewFixedPanelTab({
      environmentId: resolvedEnvironmentId,
      projectId: resolvedEnvironmentId === null ? projectId : null,
      tab: {
        lineRange: null,
        path: selection.path,
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
  }

  if (!threadId) return null;
  return createStorageTab(
    resolvedEnvironmentId ?? null,
    {
      lineRange: null,
      path: selection.path,
    },
    threadId,
  );
}

function setPrunedSecondaryTabs({
  activeTabId,
  stateTabs,
  tabs,
}: PruneSecondaryTabsArgs): {
  activeTabId: string | null;
  tabs: readonly FixedPanelTab[];
} {
  return {
    activeTabId: getActiveTabIdAfterPrune(tabs, activeTabId),
    tabs: tabs === stateTabs ? stateTabs : tabs,
  };
}

export function useThreadFileTabs({
  threadId,
  environmentId,
  fileOwnerThreadId,
  preserveWorkspaceTabsAcrossContexts = false,
  projectId = null,
  retainedTerminalId = null,
  storageFiles,
  terminalSessions,
}: UseThreadFileTabsParams) {
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(threadId);
  const recordRecentItem = useRecordThreadRecentItem(threadId);
  const isThreadResolved = threadId !== null && threadId !== undefined;
  const resolvedFileOwnerThreadId =
    fileOwnerThreadId !== undefined
      ? fileOwnerThreadId
      : isThreadResolved
        ? threadId
        : null;
  const resolvedEnvironmentId = isThreadResolved ? environmentId : undefined;

  useEffect(() => {
    if (!resolvedFileOwnerThreadId) return;
    updateFixedPanelTabsState((state) => {
      let didChange = false;
      const tabIdMap = new Map<string, string>();
      const seenTabIds = new Set<string>();
      const tabs: FixedPanelTab[] = [];
      for (const tab of state.secondary.tabs) {
        let nextTab = tab;
        if (
          tab.kind === "host-file-preview" &&
          tab.threadId === null &&
          resolvedEnvironmentId
        ) {
          nextTab = createHostFilePreviewFixedPanelTab({
            environmentId: resolvedEnvironmentId,
            tab: {
              lineRange: tab.lineRange,
              path: tab.path,
            },
            threadId: resolvedFileOwnerThreadId,
          });
          didChange = true;
          tabIdMap.set(tab.id, nextTab.id);
        } else if (
          tab.kind === "thread-storage-file-preview" &&
          tab.threadId === null
        ) {
          nextTab = createThreadStorageFilePreviewFixedPanelTab({
            environmentId: tab.environmentId ?? resolvedEnvironmentId ?? null,
            isPinned: tab.isPinned,
            tab: {
              lineRange: tab.lineRange,
              path: tab.path,
            },
            threadId: resolvedFileOwnerThreadId,
          });
          didChange = true;
          tabIdMap.set(tab.id, nextTab.id);
        }
        if (seenTabIds.has(nextTab.id)) {
          didChange = true;
          tabIdMap.set(tab.id, nextTab.id);
          continue;
        }
        seenTabIds.add(nextTab.id);
        tabs.push(nextTab);
      }
      if (!didChange) return state;
      const activeTabId =
        state.secondary.activeTabId === null
          ? null
          : (tabIdMap.get(state.secondary.activeTabId) ??
            state.secondary.activeTabId);
      return setSecondaryPanelTabsInState({
        activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs,
      });
    });
  }, [
    resolvedEnvironmentId,
    resolvedFileOwnerThreadId,
    updateFixedPanelTabsState,
  ]);

  useEffect(() => {
    if (preserveWorkspaceTabsAcrossContexts) return;
    if (resolvedEnvironmentId === undefined) return;
    updateFixedPanelTabsState((state) => {
      const pruned = setPrunedSecondaryTabs({
        activeTabId: state.secondary.activeTabId,
        stateTabs: state.secondary.tabs,
        tabs: removeWorkspaceTabsForOtherEnvironments(
          state.secondary.tabs,
          resolvedEnvironmentId,
        ),
      });
      return setSecondaryPanelTabsInState({
        activeTabId: pruned.activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs: pruned.tabs,
      });
    });
  }, [
    preserveWorkspaceTabsAcrossContexts,
    resolvedEnvironmentId,
    updateFixedPanelTabsState,
  ]);

  useEffect(() => {
    if (!isThreadResolved || !storageFiles) return;
    updateFixedPanelTabsState((state) => {
      const knownPaths = new Set(storageFiles.map((file) => file.path));
      const pruned = setPrunedSecondaryTabs({
        activeTabId: state.secondary.activeTabId,
        stateTabs: state.secondary.tabs,
        tabs: pruneStorageTabs({
          knownPaths,
          tabs: state.secondary.tabs,
          threadId: resolvedFileOwnerThreadId,
        }),
      });
      return setSecondaryPanelTabsInState({
        activeTabId: pruned.activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs: pruned.tabs,
      });
    });
  }, [
    isThreadResolved,
    resolvedFileOwnerThreadId,
    storageFiles,
    updateFixedPanelTabsState,
  ]);

  useEffect(() => {
    if (!isThreadResolved || terminalSessions === undefined) return;
    updateFixedPanelTabsState((state) => {
      const pruned = setPrunedSecondaryTabs({
        activeTabId: state.secondary.activeTabId,
        stateTabs: state.secondary.tabs,
        tabs: pruneTerminalTabsForSessions({
          retainedTerminalId,
          tabs: state.secondary.tabs,
          terminalSessions,
        }),
      });
      return setSecondaryPanelTabsInState({
        activeTabId: pruned.activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs: pruned.tabs,
      });
    });
  }, [
    isThreadResolved,
    retainedTerminalId,
    terminalSessions,
    updateFixedPanelTabsState,
  ]);

  const openTab = useCallback(
    (request: OpenSecondaryPanelTabRequest) => {
      const tab = createTabForOpenRequest({
        projectId,
        request,
        resolvedEnvironmentId,
        threadId: resolvedFileOwnerThreadId,
      });
      if (tab === null) return;

      if (
        request.kind === "workspace-file-preview" &&
        request.tab.source.kind === "working-tree"
      ) {
        recordRecentItem({ source: "workspace", path: request.tab.path });
      }
      if (request.kind === "thread-storage-file-preview") {
        recordRecentItem({ source: "thread-storage", path: request.tab.path });
      }

      updateFixedPanelTabsState((state) => {
        if (request.kind === "browser") {
          return replaceNewTabWithSecondaryPanelTabInState({ state, tab });
        }
        return openSecondaryPanelTabInState({ state, tab });
      });
    },
    [
      recordRecentItem,
      projectId,
      resolvedEnvironmentId,
      resolvedFileOwnerThreadId,
      updateFixedPanelTabsState,
    ],
  );

  const activateTab = useCallback(
    (tabId: string) => {
      updateFixedPanelTabsState((state) =>
        activateSecondaryPanelTabInState(state, tabId),
      );
    },
    [updateFixedPanelTabsState],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      updateFixedPanelTabsState((state) =>
        closeSecondaryPanelTabInState(state, tabId),
      );
    },
    [updateFixedPanelTabsState],
  );

  // Opens a side chat: normally appends a fresh tab because the source message
  // is not a stable identity; the New tab launcher can opt into replacing its
  // transient tab, matching file/browser launcher behavior.
  const openSideChat = useCallback(
    ({
      replaceNewTab = false,
      sourceMessageText,
      sourceSeqEnd,
    }: OpenSideChatArgs) => {
      const nextTab = createSideChatFixedPanelTab({
        sourceMessageText,
        sourceSeqEnd,
        title: SIDE_CHAT_TAB_TITLE,
      });
      updateFixedPanelTabsState((state) => {
        if (replaceNewTab) {
          return replaceNewTabWithSecondaryPanelTabInState({
            state,
            tab: nextTab,
          });
        }
        return openSecondaryPanelTabInState({ state, tab: nextTab });
      });
    },
    [updateFixedPanelTabsState],
  );

  // Opens an EXISTING side-chat child thread as a tab (e.g. from the "Message
  // from side chat" link in the main timeline). Activates the tab if one is
  // already open for that thread; otherwise creates one pre-pointed at it (no
  // anchor message — the conversation is already there).
  const openExistingSideChatTab = useCallback(
    (childThreadId: string) => {
      updateFixedPanelTabsState((state) => {
        const existing = state.secondary.tabs.find(
          (tab) => isSideChatTab(tab) && tab.threadId === childThreadId,
        );
        if (existing) {
          return activateSecondaryPanelTabInState(state, existing.id);
        }
        const nextTab = {
          ...createSideChatFixedPanelTab({
            sourceMessageText: "",
            title: SIDE_CHAT_TAB_TITLE,
          }),
          threadId: childThreadId,
        };
        return openSecondaryPanelTabInState({ state, tab: nextTab });
      });
    },
    [updateFixedPanelTabsState],
  );

  // Records the child thread id once first send creates it, so later turns
  // render against the persisted thread and the tab survives reloads.
  const setSideChatThreadId = useCallback(
    ({ tabId, threadId: childThreadId }: SetSideChatThreadIdArgs) => {
      updateFixedPanelTabsState((state) => {
        const tab = findSecondaryPanelTab(state.secondary.tabs, tabId);
        if (
          !tab ||
          !isSideChatTab(tab) ||
          tab.threadId === childThreadId
        ) {
          return state;
        }
        return updateSecondaryPanelTabInState({
          state,
          tab: {
            ...tab,
            threadId: childThreadId,
          },
        });
      });
    },
    [updateFixedPanelTabsState],
  );

  const activateSideChatTab = useCallback(
    (tabId: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findSecondaryPanelTab(state.secondary.tabs, tabId);
        if (!tab || !isSideChatTab(tab)) {
          return state;
        }
        return activateSecondaryPanelTabInState(state, tabId);
      });
    },
    [updateFixedPanelTabsState],
  );

  const closeSideChatTab = useCallback(
    (tabId: string) => {
      updateFixedPanelTabsState((state) => {
        const tab = findSecondaryPanelTab(state.secondary.tabs, tabId);
        if (!tab || !isSideChatTab(tab)) {
          return state;
        }
        return closeSecondaryPanelTabInState(state, tabId);
      });
    },
    [updateFixedPanelTabsState],
  );

  const selectFileSearchResult = useCallback(
    (selection: FileSearchSelection) => {
      const tab = createTabForFileSearchSelection({
        projectId,
        resolvedEnvironmentId,
        selection,
        threadId: resolvedFileOwnerThreadId,
      });
      if (tab === null) return;

      if (selection.source === "workspace") {
        recordRecentItem({ source: "workspace", path: selection.path });
      } else {
        recordRecentItem({ source: "thread-storage", path: selection.path });
      }

      updateFixedPanelTabsState((state) =>
        replaceNewTabWithSecondaryPanelTabInState({ state, tab }),
      );
    },
    [
      projectId,
      recordRecentItem,
      resolvedEnvironmentId,
      resolvedFileOwnerThreadId,
      updateFixedPanelTabsState,
    ],
  );

  const updateBrowserTab = useCallback(
    ({ tabId, url, title }: UpdateBrowserTabArgs) => {
      updateFixedPanelTabsState((state) => {
        const tab = findSecondaryPanelTab(state.secondary.tabs, tabId);
        if (!tab || !isBrowserTab(tab)) {
          return state;
        }
        return updateSecondaryPanelTabInState({
          state,
          tab: {
            ...tab,
            title,
            url,
          },
        });
      });
    },
    [updateFixedPanelTabsState],
  );

  const clearActiveFileTabs = useCallback(() => {
    updateFixedPanelTabsState(clearActiveSecondaryFileTabInState);
  }, [updateFixedPanelTabsState]);

  const reorderFileTab = useCallback<SecondaryPanelTabReorderHandler>(
    (request: SecondaryPanelTabReorderRequest) => {
      updateFixedPanelTabsState((state) =>
        reorderSecondaryPanelFileTabInState({ ...request, state }),
      );
    },
    [updateFixedPanelTabsState],
  );

  const activeTab = getActiveSecondaryPanelTab(fixedPanelTabsState);
  const orderedSecondaryFileTabs = buildOrderedSecondaryPanelFileTabs({
    includeWorkspaceTabsOutsideEnvironment: preserveWorkspaceTabsAcrossContexts,
    tabs: fixedPanelTabsState.secondary.tabs,
    resolvedEnvironmentId,
  });
  const browserTabs = useMemo(
    () => fixedPanelTabsState.secondary.tabs.filter(isBrowserTab),
    [fixedPanelTabsState.secondary.tabs],
  );
  // Every open side-chat tab in insertion order. The secondary panel keeps a
  // live conversation surface mounted for each one (only the active tab shown)
  // so streaming survives tab switches — the same keep-mounted deck pattern as
  // browser tabs.
  const sideChatTabs = useMemo(
    () => fixedPanelTabsState.secondary.tabs.filter(isSideChatTab),
    [fixedPanelTabsState.secondary.tabs],
  );
  const activeWorkspaceFileTab =
    activeTab?.kind === "workspace-file-preview" &&
    (preserveWorkspaceTabsAcrossContexts ||
      activeTab.environmentId === resolvedEnvironmentId)
      ? activeTab
      : null;
  const activeStorageFileTab =
    activeTab?.kind === "thread-storage-file-preview" ? activeTab : null;
  const activeHostFileTab =
    activeTab?.kind === "host-file-preview" ? activeTab : null;
  const activeBrowserTab = activeTab?.kind === "browser" ? activeTab : null;
  const activeNewTab = activeTab?.kind === "new-tab" ? activeTab : null;
  const activeSideChatTab =
    activeTab?.kind === "side-chat" ? activeTab : null;

  return {
    activateTab,
    activeBrowserTab,
    activeHostFileEnvironmentId: activeHostFileTab?.environmentId ?? null,
    activeHostFileLineRange: activeHostFileTab?.lineRange ?? null,
    activeHostFilePath: activeHostFileTab?.path ?? null,
    activeHostFileThreadId: activeHostFileTab?.threadId ?? null,
    activeStorageFileEnvironmentId: activeStorageFileTab?.environmentId ?? null,
    activeStorageFileLineRange: activeStorageFileTab?.lineRange ?? null,
    activeStorageFilePath: activeStorageFileTab?.path ?? null,
    activeStorageFileThreadId: activeStorageFileTab?.threadId ?? null,
    activeWorkspaceFileLineRange: activeWorkspaceFileTab?.lineRange ?? null,
    activeWorkspaceFileEnvironmentId:
      activeWorkspaceFileTab?.environmentId ?? null,
    activeWorkspaceFilePath: activeWorkspaceFileTab?.path ?? null,
    activeWorkspaceFileProjectId: activeWorkspaceFileTab?.projectId ?? null,
    activeWorkspaceFileSource: activeWorkspaceFileTab?.source ?? null,
    activeWorkspaceFileStatusLabel: activeWorkspaceFileTab?.statusLabel ?? null,
    activeSideChatTabId: activeSideChatTab?.id ?? null,
    activateSideChatTab,
    browserTabs,
    clearActiveFileTabs,
    closeSideChatTab,
    closeTab,
    isNewTabActive: activeNewTab !== null,
    openSideChat,
    openExistingSideChatTab,
    openTab,
    orderedSecondaryFileTabs,
    reorderFileTab,
    selectFileSearchResult,
    setSideChatThreadId,
    sideChatTabs,
    updateBrowserTab,
  };
}
