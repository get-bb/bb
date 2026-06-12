import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HostFileTabState,
  ThreadStorageFileTabState,
  WorkspaceFileTabState,
} from "@/lib/file-preview";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";

type ThreadSecondaryPanelThreadId = string | undefined;
type ThreadDetailSurface = "page" | "popout";

export type ThreadSecondaryPanelOpenHandler = (
  panel: ThreadSecondaryPanel,
) => void;
export type ThreadSecondaryPanelDiffFileOpenHandler = (path: string) => void;
export type ThreadSecondaryPanelCommitDiffOpenHandler = (sha: string) => void;
export type ThreadSecondaryPanelWorkspaceFileOpenHandler = (
  file: WorkspaceFileTabState,
) => void;
export type ThreadSecondaryPanelStorageFileOpenHandler = (
  file: ThreadStorageFileTabState,
) => void;
export type ThreadSecondaryPanelHostFileOpenHandler = (
  file: HostFileTabState,
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
  surface: ThreadDetailSurface;
  threadId: ThreadSecondaryPanelThreadId;
  togglePersistedPanel: () => void;
}

export interface ThreadSecondaryPanelVisibility {
  closePanel: () => void;
  isOpen: boolean;
  openCommitDiff: ThreadSecondaryPanelCommitDiffOpenHandler;
  openDiffFile: ThreadSecondaryPanelDiffFileOpenHandler;
  openDiffPanel: () => void;
  openHostFile: ThreadSecondaryPanelHostFileOpenHandler;
  openPanel: ThreadSecondaryPanelOpenHandler;
  openStorageFile: ThreadSecondaryPanelStorageFileOpenHandler;
  openWorkspaceFile: ThreadSecondaryPanelWorkspaceFileOpenHandler;
  togglePanel: () => void;
}

function hasThreadId(threadId: ThreadSecondaryPanelThreadId): threadId is string {
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
  surface,
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

  const isDrawerVisible =
    hasThreadId(threadId) && openDrawerThreadId === threadId;
  const isOpen =
    surface === "popout"
      ? false
      : isCompactViewport
        ? isDrawerVisible
        : isPersistedOpen;

  const openPanel = useCallback<ThreadSecondaryPanelOpenHandler>(
    (panel) => {
      if (surface === "popout") {
        return;
      }
      openPersistedPanel(panel);
      if (isCompactViewport) {
        openDrawerForCurrentThread();
      }
    },
    [isCompactViewport, openDrawerForCurrentThread, openPersistedPanel, surface],
  );

  const openDiffPanel = useCallback(() => {
    if (surface === "popout") {
      return;
    }
    openPersistedDiffPanel();
    if (isCompactViewport) {
      openDrawerForCurrentThread();
    }
  }, [
    isCompactViewport,
    openDrawerForCurrentThread,
    openPersistedDiffPanel,
    surface,
  ]);

  const openDiffFile = useCallback<ThreadSecondaryPanelDiffFileOpenHandler>(
    (path) => {
      if (surface === "popout") {
        return;
      }
      openPersistedDiffFile(path);
      if (isCompactViewport) {
        openDrawerForCurrentThread();
      }
    },
    [
      isCompactViewport,
      openDrawerForCurrentThread,
      openPersistedDiffFile,
      surface,
    ],
  );

  const openCommitDiff = useCallback<ThreadSecondaryPanelCommitDiffOpenHandler>(
    (sha) => {
      if (surface === "popout") {
        return;
      }
      openPersistedCommitDiff(sha);
      if (isCompactViewport) {
        openDrawerForCurrentThread();
      }
    },
    [
      isCompactViewport,
      openDrawerForCurrentThread,
      openPersistedCommitDiff,
      surface,
    ],
  );

  const openWorkspaceFile =
    useCallback<ThreadSecondaryPanelWorkspaceFileOpenHandler>(
      (file) => {
        if (surface === "popout") {
          return;
        }
        openPersistedWorkspaceFile(file);
        if (isCompactViewport) {
          openDrawerForCurrentThread();
        }
      },
      [
        isCompactViewport,
        openDrawerForCurrentThread,
        openPersistedWorkspaceFile,
        surface,
      ],
    );

  const openStorageFile =
    useCallback<ThreadSecondaryPanelStorageFileOpenHandler>(
      (file) => {
        if (surface === "popout") {
          return;
        }
        openPersistedStorageFile(file);
        if (isCompactViewport) {
          openDrawerForCurrentThread();
        }
      },
      [
        isCompactViewport,
        openDrawerForCurrentThread,
        openPersistedStorageFile,
        surface,
      ],
    );

  const openHostFile = useCallback<ThreadSecondaryPanelHostFileOpenHandler>(
    (file) => {
      if (surface === "popout") {
        return;
      }
      openPersistedHostFile(file);
      if (isCompactViewport) {
        openDrawerForCurrentThread();
      }
    },
    [
      isCompactViewport,
      openDrawerForCurrentThread,
      openPersistedHostFile,
      surface,
    ],
  );

  const closePanel = useCallback(() => {
    if (surface === "popout") {
      return;
    }
    if (isCompactViewport) {
      closeDrawerForCurrentThread();
      return;
    }
    closePersistedPanel();
  }, [
    closeDrawerForCurrentThread,
    closePersistedPanel,
    isCompactViewport,
    surface,
  ]);

  const togglePanel = useCallback(() => {
    if (surface === "popout") {
      return;
    }
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
    surface,
    togglePersistedPanel,
  ]);

  return useMemo(
    () => ({
      closePanel,
      isOpen,
      openCommitDiff,
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
