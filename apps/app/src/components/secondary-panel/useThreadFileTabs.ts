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
  createPluginPanelFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type BrowserFixedPanelTab,
  type FixedPanelTab,
  type HostFilePreviewFixedPanelTab,
  type NewTabFixedPanelTab,
  type PluginPanelFixedPanelTab,
  type ThreadStorageFilePreviewFixedPanelTab,
  type WorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { usePluginSlots } from "@/lib/plugin-slots";
import { useFileOpenerPreferenceValue } from "@/lib/file-opener-preference";
import {
  createFileOpenerTabForRequest,
  fileOpenerIdFromActionId,
  type FileTabViewerOverride,
} from "@/components/plugin/file-opener-tabs";
import type { OpenPluginPanelArgs } from "@/components/plugin/PluginPanelActions";
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
  panelStateId: string | null | undefined;
  syncThreadId: string | null | undefined;
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
  | NewTabFixedPanelTab
  | PluginPanelFixedPanelTab;

// Every side chat uses a constant tab title; the message it was triggered from
// is shown inside the panel ("Replying to" bubble), so the tab needn't echo it.

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
  panelStateId,
  syncThreadId,
  environmentId,
  fileOwnerThreadId,
  preserveWorkspaceTabsAcrossContexts = false,
  projectId = null,
  retainedTerminalId = null,
  storageFiles,
  terminalSessions,
}: UseThreadFileTabsParams) {
  const fixedPanelTabsState = useFixedPanelTabsState(
    panelStateId,
    syncThreadId,
  );
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(
    panelStateId,
    syncThreadId,
  );
  const recordRecentItem = useRecordThreadRecentItem(panelStateId);
  const isPanelStateResolved =
    panelStateId !== null && panelStateId !== undefined;
  const resolvedFileOwnerThreadId =
    fileOwnerThreadId !== undefined
      ? fileOwnerThreadId
      : (syncThreadId ?? null);
  const resolvedEnvironmentId = isPanelStateResolved
    ? environmentId
    : undefined;

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
    if (!isPanelStateResolved || !storageFiles) return;
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
    isPanelStateResolved,
    resolvedFileOwnerThreadId,
    storageFiles,
    updateFixedPanelTabsState,
  ]);

  useEffect(() => {
    if (!isPanelStateResolved || terminalSessions === undefined) return;
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
    isPanelStateResolved,
    retainedTerminalId,
    terminalSessions,
    updateFixedPanelTabsState,
  ]);

  const { fileOpeners } = usePluginSlots();
  const fileOpenerPreference = useFileOpenerPreferenceValue();

  const openTab = useCallback(
    (
      request: OpenSecondaryPanelTabRequest,
      options?: { viewer?: FileTabViewerOverride },
    ): SecondaryPanelTab | null => {
      // Opener diversion (plugin design §5.2): every file-open flow
      // funnels through here (links, file search, `bb thread open`), so a
      // matching plugin opener applies uniformly. Falls through to the
      // built-in tab when no opener matches; a link menu's per-open viewer
      // choice overrides automatic or pinned resolution in either direction.
      const openerTab = createFileOpenerTabForRequest({
        fileOpeners,
        preference: fileOpenerPreference,
        projectId,
        request,
        resolvedEnvironmentId,
        threadId: resolvedFileOwnerThreadId,
        ...(options?.viewer !== undefined ? { viewer: options.viewer } : {}),
      });
      const tab =
        openerTab ??
        createTabForOpenRequest({
          projectId,
          request,
          resolvedEnvironmentId,
          threadId: resolvedFileOwnerThreadId,
        });
      if (tab === null) return null;

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
      return tab;
    },
    [
      fileOpenerPreference,
      fileOpeners,
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

  // Opens (or focuses) a plugin panel tab from a `threadPanelAction`. Params
  // are part of the tab identity: identical params focus the existing tab
  // (refreshing its title), different params open a sibling tab. Launched
  // from the new-tab page, so the transient new-tab is replaced like the
  // file/browser launchers do.
  const openPluginPanel = useCallback(
    ({ pluginId, actionId, title, paramsJson }: OpenPluginPanelArgs) => {
      const tab = createPluginPanelFixedPanelTab({
        actionId,
        paramsJson,
        pluginId,
        title,
      });
      updateFixedPanelTabsState((state) => {
        const existing = findSecondaryPanelTab(state.secondary.tabs, tab.id);
        if (existing !== null && existing.kind === "plugin-panel") {
          const withTitle =
            existing.title === title
              ? state
              : updateSecondaryPanelTabInState({
                  state,
                  tab: { ...existing, title },
                });
          return activateSecondaryPanelTabInState(withTitle, tab.id);
        }
        return replaceNewTabWithSecondaryPanelTabInState({ state, tab });
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
  const activePluginPanelTab =
    activeTab?.kind === "plugin-panel" ? activeTab : null;
  const activeFileOpenerOwner =
    activePluginPanelTab !== null &&
    fileOpenerIdFromActionId(activePluginPanelTab.actionId) !== null
      ? (activePluginPanelTab.fileOpenerOwner ?? null)
      : null;

  return {
    activateTab,
    activeBrowserTab,
    activeFileOpenerOwner,
    activeHostFileEnvironmentId:
      activeHostFileTab?.environmentId ??
      (activeFileOpenerOwner?.kind === "host-file-preview"
        ? activeFileOpenerOwner.environmentId
        : null),
    activeHostFileLineRange:
      activeHostFileTab?.lineRange ??
      (activeFileOpenerOwner?.kind === "host-file-preview"
        ? activeFileOpenerOwner.tab.lineRange
        : null),
    activeHostFilePath:
      activeHostFileTab?.path ??
      (activeFileOpenerOwner?.kind === "host-file-preview"
        ? activeFileOpenerOwner.tab.path
        : null),
    activeHostFileThreadId:
      activeHostFileTab?.threadId ??
      (activeFileOpenerOwner?.kind === "host-file-preview"
        ? activeFileOpenerOwner.threadId
        : null),
    activeStorageFileEnvironmentId:
      activeStorageFileTab?.environmentId ??
      (activeFileOpenerOwner?.kind === "thread-storage-file-preview"
        ? activeFileOpenerOwner.environmentId
        : null),
    activeStorageFileLineRange:
      activeStorageFileTab?.lineRange ??
      (activeFileOpenerOwner?.kind === "thread-storage-file-preview"
        ? activeFileOpenerOwner.tab.lineRange
        : null),
    activeStorageFilePath:
      activeStorageFileTab?.path ??
      (activeFileOpenerOwner?.kind === "thread-storage-file-preview"
        ? activeFileOpenerOwner.tab.path
        : null),
    activeStorageFileThreadId:
      activeStorageFileTab?.threadId ??
      (activeFileOpenerOwner?.kind === "thread-storage-file-preview"
        ? activeFileOpenerOwner.threadId
        : null),
    activeWorkspaceFileLineRange:
      activeWorkspaceFileTab?.lineRange ??
      (activeFileOpenerOwner?.kind === "workspace-file-preview"
        ? activeFileOpenerOwner.tab.lineRange
        : null),
    activeWorkspaceFileEnvironmentId:
      activeWorkspaceFileTab?.environmentId ??
      (activeFileOpenerOwner?.kind === "workspace-file-preview"
        ? activeFileOpenerOwner.environmentId
        : null),
    activeWorkspaceFilePath:
      activeWorkspaceFileTab?.path ??
      (activeFileOpenerOwner?.kind === "workspace-file-preview"
        ? activeFileOpenerOwner.tab.path
        : null),
    activeWorkspaceFileProjectId:
      activeWorkspaceFileTab?.projectId ??
      (activeFileOpenerOwner?.kind === "workspace-file-preview"
        ? activeFileOpenerOwner.projectId
        : null),
    activeWorkspaceFileSource:
      activeWorkspaceFileTab?.source ??
      (activeFileOpenerOwner?.kind === "workspace-file-preview"
        ? activeFileOpenerOwner.tab.source
        : null),
    activeWorkspaceFileStatusLabel:
      activeWorkspaceFileTab?.statusLabel ??
      (activeFileOpenerOwner?.kind === "workspace-file-preview"
        ? activeFileOpenerOwner.tab.statusLabel
        : null),
    activePluginPanelTab,
    browserTabs,
    clearActiveFileTabs,
    closeTab,
    isNewTabActive: activeNewTab !== null,
    openPluginPanel,
    openTab,
    orderedSecondaryFileTabs,
    reorderFileTab,
    selectFileSearchResult,
    updateBrowserTab,
  };
}
