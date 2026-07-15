import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HostFileTabState,
  ThreadStorageFileTabState,
  WorkspaceFileTabState,
} from "@/lib/file-preview";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";
import type { FileTabViewerOverride } from "@/components/plugin/file-opener-tabs";

type ThreadSecondaryPanelThreadId = string | undefined;

export type ThreadSecondaryPanelOpenHandler = (
  panel: ThreadSecondaryPanel,
) => void;
export type ThreadSecondaryPanelDiffFileOpenHandler = (path: string) => void;
export type ThreadSecondaryPanelCommitDiffOpenHandler = (sha: string) => void;
export interface ThreadSecondaryPanelFileOpenOptions {
  /** Per-open viewer choice (link context menu); absent = extension default. */
  viewer?: FileTabViewerOverride;
}
export type ThreadSecondaryPanelWorkspaceFileOpenHandler = (
  file: WorkspaceFileTabState,
  options?: ThreadSecondaryPanelFileOpenOptions,
) => void;
export type ThreadSecondaryPanelStorageFileOpenHandler = (
  file: ThreadStorageFileTabState,
  options?: ThreadSecondaryPanelFileOpenOptions,
) => void;
export type ThreadSecondaryPanelHostFileOpenHandler = (
  file: HostFileTabState,
  options?: ThreadSecondaryPanelFileOpenOptions,
) => void;

export interface UseThreadSecondaryPanelVisibilityArgs {
  closePersistedPanel: () => void;
  isCompactViewport: boolean;
  isPersistedOpen: boolean;
  openPersistedCommitDiff: ThreadSecondaryPanelCommitDiffOpenHandler;
  openPersistedDiffFile: ThreadSecondaryPanelDiffFileOpenHandler;
  openPersistedDiffPanel: () => void;
  openPersistedHostFile: ThreadSecondaryPanelHostFileOpenHandler;
  openPersistedPanel: ThreadSecondaryPanelOpenHandler;
  openPersistedStorageFile: ThreadSecondaryPanelStorageFileOpenHandler;
  openPersistedWorkspaceFile: ThreadSecondaryPanelWorkspaceFileOpenHandler;
  threadId: ThreadSecondaryPanelThreadId;
  togglePersistedPanel: () => void;
}

export interface ThreadSecondaryPanelVisibility {
  closePanel: () => void;
  isOpen: boolean;
  openCommitDiff: ThreadSecondaryPanelCommitDiffOpenHandler;
  openCompactDrawer: () => void;
  openDiffFile: ThreadSecondaryPanelDiffFileOpenHandler;
  openDiffPanel: () => void;
  openHostFile: ThreadSecondaryPanelHostFileOpenHandler;
  openPanel: ThreadSecondaryPanelOpenHandler;
  openStorageFile: ThreadSecondaryPanelStorageFileOpenHandler;
  openWorkspaceFile: ThreadSecondaryPanelWorkspaceFileOpenHandler;
  togglePanel: () => void;
}

function hasThreadId(
  threadId: ThreadSecondaryPanelThreadId,
): threadId is string {
  return threadId !== undefined && threadId.length > 0;
}

export function useThreadSecondaryPanelVisibility({
  closePersistedPanel,
  isCompactViewport,
  isPersistedOpen,
  openPersistedCommitDiff,
  openPersistedDiffFile,
  openPersistedDiffPanel,
  openPersistedHostFile,
  openPersistedPanel,
  openPersistedStorageFile,
  openPersistedWorkspaceFile,
  threadId,
  togglePersistedPanel,
}: UseThreadSecondaryPanelVisibilityArgs): ThreadSecondaryPanelVisibility {
  const [openDrawerThreadId, setOpenDrawerThreadId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setOpenDrawerThreadId(null);
  }, [threadId]);

  useEffect(() => {
    if (!isCompactViewport) {
      setOpenDrawerThreadId(null);
    }
  }, [isCompactViewport]);

  const openDrawerForCurrentThread = useCallback(() => {
    if (!hasThreadId(threadId)) {
      return;
    }
    setOpenDrawerThreadId(threadId);
  }, [threadId]);

  const closeDrawerForCurrentThread = useCallback(() => {
    setOpenDrawerThreadId((currentThreadId) =>
      currentThreadId === threadId ? null : currentThreadId,
    );
  }, [threadId]);

  const openCompactDrawer = useCallback(() => {
    if (!isCompactViewport) {
      return;
    }
    openDrawerForCurrentThread();
  }, [isCompactViewport, openDrawerForCurrentThread]);

  const isDrawerVisible =
    hasThreadId(threadId) && openDrawerThreadId === threadId;
  const isOpen = isCompactViewport ? isDrawerVisible : isPersistedOpen;

  const openPanel = useCallback<ThreadSecondaryPanelOpenHandler>(
    (panel) => {
      openPersistedPanel(panel);
      openCompactDrawer();
    },
    [openCompactDrawer, openPersistedPanel],
  );

  const openDiffPanel = useCallback(() => {
    openPersistedDiffPanel();
    openCompactDrawer();
  }, [openCompactDrawer, openPersistedDiffPanel]);

  const openDiffFile = useCallback<ThreadSecondaryPanelDiffFileOpenHandler>(
    (path) => {
      openPersistedDiffFile(path);
      openCompactDrawer();
    },
    [openCompactDrawer, openPersistedDiffFile],
  );

  const openCommitDiff = useCallback<ThreadSecondaryPanelCommitDiffOpenHandler>(
    (sha) => {
      openPersistedCommitDiff(sha);
      openCompactDrawer();
    },
    [openCompactDrawer, openPersistedCommitDiff],
  );

  const openWorkspaceFile =
    useCallback<ThreadSecondaryPanelWorkspaceFileOpenHandler>(
      (file, options) => {
        if (options !== undefined) openPersistedWorkspaceFile(file, options);
        else openPersistedWorkspaceFile(file);
        openCompactDrawer();
      },
      [openCompactDrawer, openPersistedWorkspaceFile],
    );

  const openStorageFile =
    useCallback<ThreadSecondaryPanelStorageFileOpenHandler>(
      (file, options) => {
        if (options !== undefined) openPersistedStorageFile(file, options);
        else openPersistedStorageFile(file);
        openCompactDrawer();
      },
      [openCompactDrawer, openPersistedStorageFile],
    );

  const openHostFile = useCallback<ThreadSecondaryPanelHostFileOpenHandler>(
    (file, options) => {
      if (options !== undefined) openPersistedHostFile(file, options);
      else openPersistedHostFile(file);
      openCompactDrawer();
    },
    [openCompactDrawer, openPersistedHostFile],
  );

  const closePanel = useCallback(() => {
    if (isCompactViewport) {
      closeDrawerForCurrentThread();
      return;
    }
    closePersistedPanel();
  }, [closeDrawerForCurrentThread, closePersistedPanel, isCompactViewport]);

  const togglePanel = useCallback(() => {
    if (!isCompactViewport) {
      togglePersistedPanel();
      return;
    }
    if (isDrawerVisible) {
      closeDrawerForCurrentThread();
      return;
    }
    openDrawerForCurrentThread();
  }, [
    closeDrawerForCurrentThread,
    isCompactViewport,
    isDrawerVisible,
    openDrawerForCurrentThread,
    togglePersistedPanel,
  ]);

  return useMemo(
    () => ({
      closePanel,
      isOpen,
      openCommitDiff,
      openCompactDrawer,
      openDiffFile,
      openDiffPanel,
      openHostFile,
      openPanel,
      openStorageFile,
      openWorkspaceFile,
      togglePanel,
    }),
    [
      closePanel,
      isOpen,
      openCommitDiff,
      openCompactDrawer,
      openDiffFile,
      openDiffPanel,
      openHostFile,
      openPanel,
      openStorageFile,
      openWorkspaceFile,
      togglePanel,
    ],
  );
}
