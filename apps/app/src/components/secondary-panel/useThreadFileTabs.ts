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
  parseFileOpenerParams,
} from "@/components/plugin/file-opener-tabs";
import type { FileOpenerOverride } from "@/lib/plugin-slot-resolvers";
import type { OpenPluginPanelArgs } from "@/components/plugin/PluginPanelActions";
import type {
  HostFileTabState,
  ThreadStorageFileTabState,
  WorkspaceFileTabState,
} from "@bb/client-core";
import { useRecordThreadRecentItem } from "./threadRecentItems";
import type {
  SecondaryPanelTabReorderHandler,
  SecondaryPanelTabReorderRequest,
} from "./secondaryPanelTab";
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
} from "@bb/client-core";
import { pruneTerminalTabsForSessions } from "./terminalPanelTabs";

interface UseThreadFileTabsParams {
  panelStateId: string | null | undefined;
  syncThreadId: string | null | undefined;
  environmentId: string | null | undefined;
  fileOwnerThreadId?: string | null;
  preserveWorkspaceTabsAcrossContexts?: boolean;
  projectHostId?: string | null;
  projectId?: string | null;
  retainedTerminalId?: string | null;
  storageFiles: readonly ThreadStorageFileListItem[] | undefined;
  terminalSessions: readonly TerminalSession[] | undefined;
}

interface ThreadStorageFileListItem {
  path: string;
}

interface FileSearchWorkspaceSelection {
  source: "workspace";
  path: string;
}

interface FileSearchThreadStorageSelection {
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
  | {
      kind: "workspace-file-preview";
      tab: WorkspaceFileTabState;
      /** Explicit identity; omission preserves the surface-context adapter. */
      environmentId?: string;
    }
  | {
      kind: "host-file-preview";
      tab: HostFileTabState;
      /** Explicit identity; omission preserves the thread-context adapter. */
      hostId?: string;
    }
  | {
      kind: "thread-storage-file-preview";
      tab: ThreadStorageFileTabState;
      /** Explicit identity; omission preserves the thread-context adapter. */
      threadId?: string;
    }
  | { kind: "browser"; url: string }
  | { kind: "new-tab" };

interface CreateTabForOpenRequestArgs {
  projectId: string | null;
  request: OpenSecondaryPanelTabRequest;
  resolvedEnvironmentId: string | null | undefined;
  threadId: string | null | undefined;
}

interface PruneSecondaryTabsArgs {
  activeTabId: string | null;
  tabs: readonly FixedPanelTab[];
}

type SecondaryPanelTab =
  | WorkspaceFilePreviewFixedPanelTab
  | HostFilePreviewFixedPanelTab
  | ThreadStorageFilePreviewFixedPanelTab
  | BrowserFixedPanelTab
  | NewTabFixedPanelTab
  | PluginPanelFixedPanelTab;

type OpenResolvedTabBehavior = "open" | "replace-new-tab";

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
      if (
        request.environmentId === undefined &&
        resolvedEnvironmentId === undefined
      ) {
        return null;
      }
      const workspaceEnvironmentId =
        request.environmentId ?? resolvedEnvironmentId ?? null;
      return createWorkspaceFilePreviewFixedPanelTab({
        environmentId: workspaceEnvironmentId,
        projectId: workspaceEnvironmentId === null ? projectId : null,
        tab: request.tab,
      });
    case "host-file-preview":
      if (request.hostId !== undefined) {
        return createHostFilePreviewFixedPanelTab({
          environmentId: null,
          hostId: request.hostId,
          tab: request.tab,
          threadId: null,
        });
      }
      if (!threadId || !resolvedEnvironmentId) return null;
      return createHostFilePreviewFixedPanelTab({
        environmentId: resolvedEnvironmentId,
        tab: request.tab,
        threadId,
      });
    case "thread-storage-file-preview":
      const storageThreadId = request.threadId ?? threadId;
      if (!storageThreadId) return null;
      return createStorageTab(
        resolvedEnvironmentId ?? null,
        request.tab,
        storageThreadId,
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

function openRequestForFileSearchSelection(
  selection: FileSearchSelection,
): OpenSecondaryPanelTabRequest {
  if (selection.source === "workspace") {
    return {
      kind: "workspace-file-preview",
      tab: {
        lineRange: null,
        path: selection.path,
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    };
  }

  return {
    kind: "thread-storage-file-preview",
    tab: {
      lineRange: null,
      path: selection.path,
    },
  };
}

function setPrunedSecondaryTabs({
  activeTabId,
  tabs,
}: PruneSecondaryTabsArgs): {
  activeTabId: string | null;
  tabs: readonly FixedPanelTab[];
} {
  return {
    activeTabId: getActiveTabIdAfterPrune(tabs, activeTabId),
    tabs,
  };
}

export function useThreadFileTabs({
  panelStateId,
  syncThreadId,
  environmentId,
  fileOwnerThreadId,
  preserveWorkspaceTabsAcrossContexts = false,
  projectHostId = null,
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
            hostId: tab.hostId,
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

  const openResolvedTab = useCallback(
    (
      request: OpenSecondaryPanelTabRequest,
      behavior: OpenResolvedTabBehavior,
      viewer?: FileOpenerOverride,
    ): SecondaryPanelTab | null => {
      const openerTab = createFileOpenerTabForRequest({
        fileOpeners,
        preference: fileOpenerPreference,
        projectHostId,
        projectId,
        request,
        resolvedEnvironmentId,
        threadId: resolvedFileOwnerThreadId,
        ...(viewer !== undefined ? { viewer } : {}),
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
        if (behavior === "replace-new-tab") {
          return replaceNewTabWithSecondaryPanelTabInState({ state, tab });
        }
        return openSecondaryPanelTabInState({ state, tab });
      });
      return tab;
    },
    [
      fileOpenerPreference,
      fileOpeners,
      projectHostId,
      recordRecentItem,
      projectId,
      resolvedEnvironmentId,
      resolvedFileOwnerThreadId,
      updateFixedPanelTabsState,
    ],
  );

  const openTab = useCallback(
    (
      request: OpenSecondaryPanelTabRequest,
      options?: { viewer?: FileOpenerOverride },
    ): SecondaryPanelTab | null => {
      // Browser navigation replaces the transient new-tab launcher. Other
      // ordinary opens append or focus a tab. Both paths still share the
      // same opener-or-built-in resolution above.
      return openResolvedTab(
        request,
        request.kind === "browser" ? "replace-new-tab" : "open",
        options?.viewer,
      );
    },
    [openResolvedTab],
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
      openResolvedTab(
        openRequestForFileSearchSelection(selection),
        "replace-new-tab",
      );
    },
    [openResolvedTab],
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

  const reorderTab = useCallback<SecondaryPanelTabReorderHandler>(
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
  // Params own the routed file identity; the owner only restores native
  // presentation state such as line range and workspace status.
  const activeFileOpenerFile =
    activeFileOpenerOwner === null || activePluginPanelTab === null
      ? null
      : parseFileOpenerParams(activePluginPanelTab.paramsJson);
  const activeWorkspaceFileOpener =
    activeFileOpenerOwner?.kind === "workspace-file-preview" &&
    activeFileOpenerFile?.source.kind === "workspace"
      ? activeFileOpenerFile
      : null;
  const activeHostFileOpener =
    activeFileOpenerOwner?.kind === "host-file-preview" &&
    activeFileOpenerFile?.source.kind === "host"
      ? activeFileOpenerFile
      : null;
  const activeStorageFileOpener =
    activeFileOpenerOwner?.kind === "thread-storage-file-preview" &&
    activeFileOpenerFile?.source.kind === "thread-storage"
      ? activeFileOpenerFile
      : null;

  return {
    activateTab,
    activeBrowserTab,
    activeFileOpenerFile,
    activeFileOpenerOwner,
    activeHostFileEnvironmentId:
      activeHostFileTab?.environmentId ??
      activeHostFileOpener?.source.environmentId ??
      null,
    activeHostFileLineRange:
      activeHostFileTab?.lineRange ??
      (activeFileOpenerOwner?.kind === "host-file-preview"
        ? activeFileOpenerOwner.tab.lineRange
        : null),
    activeHostFilePath:
      activeHostFileTab?.path ?? activeHostFileOpener?.path ?? null,
    activeHostFileThreadId:
      activeHostFileTab?.threadId ??
      activeHostFileOpener?.source.threadId ??
      null,
    activeStorageFileEnvironmentId:
      activeStorageFileTab?.environmentId ??
      activeStorageFileOpener?.source.environmentId ??
      null,
    activeStorageFileLineRange:
      activeStorageFileTab?.lineRange ??
      (activeFileOpenerOwner?.kind === "thread-storage-file-preview"
        ? activeFileOpenerOwner.tab.lineRange
        : null),
    activeStorageFilePath:
      activeStorageFileTab?.path ?? activeStorageFileOpener?.path ?? null,
    activeStorageFileThreadId:
      activeStorageFileTab?.threadId ??
      activeStorageFileOpener?.source.threadId ??
      null,
    activeWorkspaceFileLineRange:
      activeWorkspaceFileTab?.lineRange ??
      (activeFileOpenerOwner?.kind === "workspace-file-preview"
        ? activeFileOpenerOwner.tab.lineRange
        : null),
    activeWorkspaceFileEnvironmentId:
      activeWorkspaceFileTab?.environmentId ??
      activeWorkspaceFileOpener?.source.environmentId ??
      null,
    activeWorkspaceFilePath:
      activeWorkspaceFileTab?.path ?? activeWorkspaceFileOpener?.path ?? null,
    activeWorkspaceFileProjectId:
      activeWorkspaceFileTab?.projectId ??
      activeWorkspaceFileOpener?.source.projectId ??
      null,
    activePluginPanelTab,
    browserTabs,
    clearActiveFileTabs,
    closeTab,
    isNewTabActive: activeNewTab !== null,
    openPluginPanel,
    openTab,
    orderedSecondaryFileTabs,
    reorderTab,
    selectFileSearchResult,
    updateBrowserTab,
  };
}
