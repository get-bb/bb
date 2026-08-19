import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useSetAtom } from "jotai";
import { appToast } from "@/components/ui/app-toast";
import {
  closePanesForThreadsAtom,
  type ClosePanesForThreadsResult,
} from "@/lib/split-layout/atoms";
import type { Thread } from "@bb/domain";
import {
  useArchiveThreadAndChildren,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  usePinThread,
  useUnarchiveThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import { sdk } from "@/lib/sdk";
import { useRouteState } from "@/hooks/useRouteState";
import { useDialogState } from "@/hooks/useDialogState";
import {
  getMutationErrorMessage,
  shouldShowMutationErrorToast,
} from "@/lib/mutation-errors";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  ThreadRenameDialog,
  type ThreadRenameDialogPayload,
  type ThreadRenameDialogTarget,
} from "@/components/dialogs/ThreadRenameDialog";
import {
  ThreadDeleteDialog,
  type ThreadDeleteDialogTarget,
} from "@/components/dialogs/ThreadDeleteDialog";
import { ArchivedThreadToastTitle } from "@/components/thread/ArchivedThreadToastTitle";
import { destroyPersistedBrowserViewsForThread } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { getThreadReadToggleAction } from "@/components/sidebar/threadReadState";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";

export interface ThreadActionsContextValue {
  archiveThreadAndChildren: (thread: Thread) => void;
  renameThread: (threadId: string, title: string) => void;
  requestRename: (thread: Thread) => void;
  requestDelete: (thread: Thread) => void;
  unarchiveThread: (thread: Thread) => void;
  togglePin: (thread: Thread) => void;
  toggleRead: (thread: Thread) => void;
}

const ThreadActionsContext = createContext<ThreadActionsContextValue | null>(
  null,
);

export function useThreadActions(): ThreadActionsContextValue {
  const value = useContext(ThreadActionsContext);
  if (!value) {
    throw new Error(
      "useThreadActions must be used within a <ThreadActionsProvider>",
    );
  }
  return value;
}

interface ThreadActionsProviderProps {
  children: ReactNode;
}

interface DeleteThreadActionRequest {
  childThreadsConfirmed: boolean;
  closeDialog: () => void;
  thread: Thread;
}

interface ThreadActionContext {
  childThreadCount: number;
}

/**
 * Keeps immediate archive feedback actionable without pinning a toast for the
 * full server-side recovery window. The archived thread's normal Unarchive
 * action remains available while its environment is still retiring.
 */
const ARCHIVE_UNDO_TOAST_DURATION_MS = 10_000;

export function ThreadActionsProvider({
  children,
}: ThreadActionsProviderProps) {
  // Stable across navigations: the context value below must not change per
  // pathname, or every mounted sidebar ThreadRow re-renders on each route change.
  const navigate = useRouteNavigate();
  const { threadId: viewedThreadId } = useRouteState();
  // Read the currently-viewed thread live inside async mutation callbacks: a
  // pane's stale-prune (deleted/archived thread) can move the URL between a
  // delete/archive click and its onSuccess. A captured value would then think
  // it's still viewing the removed thread and wrongly navigate the window away.
  const viewedThreadIdRef = useRef(viewedThreadId);
  useEffect(() => {
    viewedThreadIdRef.current = viewedThreadId;
  }, [viewedThreadId]);
  const closePanesForThreads = useSetAtom(closePanesForThreadsAtom);
  const archiveThreadAndChildrenMutation = useArchiveThreadAndChildren();
  const unarchiveThreadMutation = useUnarchiveThread();
  const markThreadRead = useMarkThreadRead();
  const markThreadUnread = useMarkThreadUnread();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const deleteThread = useDeleteThread();
  const updateThread = useUpdateThread();
  const threadActionContextAbortRef = useRef<AbortController | null>(null);
  // Destructure `.mutate` so useCallback deps see stable references across
  // renders. Depending on the full mutation objects would churn callback
  // identities on every isPending flip and force every useThreadActions()
  // consumer to re-render whenever any mutation fires.
  // `mutateAsync` for archive: its promise settles per call, while the
  // per-call `mutate` callbacks only fire for the latest call on this shared
  // observer. Two quick archives (one-click hover buttons make this easy)
  // must each keep their own Undo toast, pane closure, and error report.
  const { mutateAsync: archiveThreadAndChildrenMutateAsync } =
    archiveThreadAndChildrenMutation;
  const { mutate: unarchiveMutate } = unarchiveThreadMutation;
  const { mutate: markReadMutate } = markThreadRead;
  const { mutate: markUnreadMutate } = markThreadUnread;
  const { mutate: pinMutate } = pinThread;
  const { mutate: unpinMutate } = unpinThread;
  const { mutate: deleteMutate } = deleteThread;
  const { mutate: updateMutate } = updateThread;

  const renameDialog = useDialogState<ThreadRenameDialogTarget>();
  const deleteDialog = useDialogState<ThreadDeleteDialogTarget>();

  const { onClose: closeRenameDialog, onOpen: openRenameDialog } = renameDialog;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  useEffect(() => {
    return () => {
      threadActionContextAbortRef.current?.abort();
      threadActionContextAbortRef.current = null;
    };
  }, []);

  const navigateAwayIfViewing = useCallback(
    (thread: Thread) => {
      if (viewedThreadIdRef.current === thread.id) {
        // Push (not replace) so the back button still returns the user to the
        // archived/deleted thread's URL if they want to re-open it.
        navigate(getRootComposeRoutePath());
      }
    },
    [navigate],
  );

  // Single place that reconciles the URL after archive/delete closed panes.
  // When a valid pane survives, replace-navigate to it (but only when focus
  // actually moved — an unfocused close, or a stale-prune that already moved the
  // URL, leaves it correct). Otherwise run the caller's pre-split navigate-away.
  const syncNavigationAfterClose = useCallback(
    (result: ClosePanesForThreadsResult, navigateAway: () => void) => {
      if (result.removedAny && result.focusedRoute !== null) {
        if (result.focusedRoute.threadId !== viewedThreadIdRef.current) {
          navigate(getThreadRoutePath(result.focusedRoute), { replace: true });
        }
        return;
      }
      navigateAway();
    },
    [navigate],
  );

  const requestRename = useCallback(
    (thread: Thread) => {
      openRenameDialog({
        id: thread.id,
        currentTitle: getThreadDisplayTitle(thread),
      });
    },
    [openRenameDialog],
  );

  const renameThread = useCallback(
    (threadId: string, title: string) => {
      updateMutate({ id: threadId, title });
    },
    [updateMutate],
  );

  const submitRename = useCallback(
    (threadId: string, payload: ThreadRenameDialogPayload) => {
      updateMutate(
        { id: threadId, ...payload },
        {
          onSuccess: () => {
            closeRenameDialog();
          },
        },
      );
    },
    [closeRenameDialog, updateMutate],
  );

  // Fetches the delete dialog context. Returns null when the caller's request
  // was superseded (a newer click aborted us) or the fetch errored; in the
  // error case, also surfaces a toast before returning.
  const loadThreadActionContext = useCallback(
    async (
      thread: Thread,
      signal: AbortSignal,
    ): Promise<ThreadActionContext | null> => {
      try {
        const childSummary = await sdk.threads.childSummary({
          signal,
          threadId: thread.id,
        });
        if (signal.aborted) return null;

        return {
          childThreadCount: childSummary?.nonDeletedChildCount ?? 0,
        };
      } catch (error) {
        if (signal.aborted) return null;
        if (shouldShowMutationErrorToast(error)) {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to check thread state",
            }),
          );
        }
        return null;
      }
    },
    [],
  );

  const claimThreadActionContextAbortController =
    useCallback((): AbortController => {
      threadActionContextAbortRef.current?.abort();
      const controller = new AbortController();
      threadActionContextAbortRef.current = controller;
      return controller;
    }, []);

  function buildDialogTargetFromContext<T extends { thread: Thread }>(
    base: T,
    context: ThreadActionContext,
  ): T & { childThreadCount?: number } {
    return {
      ...base,
      ...(context.childThreadCount > 0
        ? { childThreadCount: context.childThreadCount }
        : {}),
    };
  }

  const performDelete = useCallback(
    ({
      childThreadsConfirmed,
      closeDialog,
      thread,
    }: DeleteThreadActionRequest) => {
      deleteMutate(
        { id: thread.id, childThreadsConfirmed },
        {
          onSuccess: () => {
            destroyPersistedBrowserViewsForThread({
              desktopBrowser: getDesktopBrowserApi(),
              threadId: thread.id,
            });
            closeDialog();
            // In a split, close the pane holding this thread and move the URL
            // to the surviving focused pane; single pane falls through to the
            // navigate-away.
            syncNavigationAfterClose(closePanesForThreads([thread.id]), () =>
              navigateAwayIfViewing(thread),
            );
          },
        },
      );
    },
    [
      closePanesForThreads,
      deleteMutate,
      navigateAwayIfViewing,
      syncNavigationAfterClose,
    ],
  );

  const requestDelete = useCallback(
    async (thread: Thread) => {
      const controller = claimThreadActionContextAbortController();
      const context = await loadThreadActionContext(thread, controller.signal);
      if (context === null || controller.signal.aborted) return;
      if (threadActionContextAbortRef.current === controller) {
        threadActionContextAbortRef.current = null;
      }
      openDeleteDialog(buildDialogTargetFromContext({ thread }, context));
    },
    [
      claimThreadActionContextAbortController,
      loadThreadActionContext,
      openDeleteDialog,
    ],
  );

  const confirmDelete = useCallback(
    (target: ThreadDeleteDialogTarget) => {
      performDelete({
        childThreadsConfirmed: target.childThreadCount !== undefined,
        closeDialog: closeDeleteDialog,
        thread: target.thread,
      });
    },
    [closeDeleteDialog, performDelete],
  );

  const unarchiveThreadAction = useCallback(
    (thread: Thread) => {
      unarchiveMutate({ id: thread.id });
    },
    [unarchiveMutate],
  );

  const archiveThreadAndChildrenAction = useCallback(
    (thread: Thread) => {
      archiveThreadAndChildrenMutateAsync({ id: thread.id }).then(
        (response) => {
          const navigateAwayIfArchived = () => {
            const viewed = viewedThreadIdRef.current;
            if (viewed && response.archivedThreadIds.includes(viewed)) {
              navigate(getRootComposeRoutePath());
            }
          };
          // Close any split panes showing archived threads and sync the URL
          // to the surviving focused pane; only navigate the window away
          // when nothing closed and the viewed thread was archived.
          syncNavigationAfterClose(
            closePanesForThreads(response.archivedThreadIds),
            navigateAwayIfArchived,
          );
          const toastId = `thread-archived-${thread.id}`;
          appToast.success(
            <ArchivedThreadToastTitle
              archivedThreadCount={response.archivedThreadIds.length}
              threadTitle={getThreadDisplayTitle(thread)}
              onOpenThread={() => {
                navigate(
                  getThreadRoutePath({
                    projectId: thread.projectId,
                    threadId: thread.id,
                  }),
                );
                appToast.dismiss(toastId);
              }}
            />,
            {
              action: {
                label: "Undo",
                onClick: () => {
                  for (const threadId of response.archivedThreadIds) {
                    unarchiveMutate({ id: threadId });
                  }
                },
              },
              duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
              id: toastId,
            },
          );
        },
        (error: unknown) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to archive thread and children",
              lifecycleOperation: "archive_thread",
            }),
          );
        },
      );
    },
    [
      archiveThreadAndChildrenMutateAsync,
      closePanesForThreads,
      navigate,
      syncNavigationAfterClose,
      unarchiveMutate,
    ],
  );

  const toggleRead = useCallback(
    (thread: Thread) => {
      if (getThreadReadToggleAction(thread) === "mark_unread") {
        markUnreadMutate(thread.id, {
          onError: (error) => {
            appToast.error(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Failed to mark thread unread",
              }),
            );
          },
        });
        return;
      }
      markReadMutate(thread.id, {
        onError: (error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to mark thread read",
            }),
          );
        },
      });
    },
    [markReadMutate, markUnreadMutate],
  );

  const togglePin = useCallback(
    (thread: Thread) => {
      if (thread.pinnedAt !== null) {
        unpinMutate({ id: thread.id });
        return;
      }
      pinMutate({ id: thread.id });
    },
    [pinMutate, unpinMutate],
  );

  const value = useMemo<ThreadActionsContextValue>(
    () => ({
      renameThread,
      requestRename,
      requestDelete,
      archiveThreadAndChildren: archiveThreadAndChildrenAction,
      unarchiveThread: unarchiveThreadAction,
      togglePin,
      toggleRead,
    }),
    [
      archiveThreadAndChildrenAction,
      renameThread,
      requestRename,
      requestDelete,
      togglePin,
      toggleRead,
      unarchiveThreadAction,
    ],
  );

  return (
    <ThreadActionsContext.Provider value={value}>
      {children}
      <ThreadRenameDialog
        target={renameDialog.target}
        pending={updateThread.isPending}
        onOpenChange={renameDialog.onOpenChange}
        onRename={submitRename}
      />
      <ThreadDeleteDialog
        target={deleteDialog.target}
        pending={deleteThread.isPending}
        onOpenChange={deleteDialog.onOpenChange}
        onDelete={confirmDelete}
      />
    </ThreadActionsContext.Provider>
  );
}
