import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { appToast } from "@/components/ui/app-toast";
import {
  closePanesForThreadsAtom,
  restoreClosedPanesAtom,
  type ClosePanesForThreadsResult,
} from "@/lib/split-layout/atoms";
import type { Thread } from "@bb/domain";
import {
  ArchiveThreadConfirmationRequired,
  useArchiveThreadAndChildren,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  usePinThread,
  useUnarchiveThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import {
  countCachedLiveChildThreads,
  getCachedArchiveThreadIds,
  getCachedUnarchivedDescendantIds,
} from "@/hooks/cache-owners/thread-state-cache-owner";
import { sdk } from "@/lib/sdk";
import { useRouteState } from "@/hooks/useRouteState";
import { useDialogState } from "@/hooks/useDialogState";
import { showMutationErrorToast } from "@/lib/mutation-errors";
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
import {
  ThreadArchiveDialog,
  type ThreadArchiveDialogTarget,
} from "@/components/dialogs/ThreadArchiveDialog";
import { ArchivedThreadToastDescription } from "@/components/thread/ArchivedThreadToastDescription";
import { destroyPersistedBrowserViewsForThread } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { getThreadReadToggleAction } from "@bb/client-core";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";

export interface ThreadActionsContextValue {
  requestArchive: (thread: Thread) => void;
  renameThreadAsync: (threadId: string, title: string) => Promise<void>;
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

interface ArchiveThreadActionRequest {
  childThreadsConfirmed: boolean;
  closeDialog?: () => void;
  thread: Thread;
}

interface DeleteThreadActionRequest {
  childThreadsConfirmed: boolean;
  closeDialog: () => void;
  thread: Thread;
}

interface ThreadActionContext {
  childThreadCount: number;
}

interface ArchiveOutcome {
  archivedThreadIds: readonly string[];
  settled: boolean;
  undoRequested: boolean;
}

const ARCHIVE_UNDO_TOAST_DURATION_MS = 10_000;

export function ThreadActionsProvider({
  children,
}: ThreadActionsProviderProps) {
  const navigate = useRouteNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const viewedRoute = `${location.pathname}${location.search}${location.hash}`;
  const viewedRouteRef = useRef(viewedRoute);
  useEffect(() => {
    viewedRouteRef.current = viewedRoute;
  }, [viewedRoute]);
  const { threadId: viewedThreadId } = useRouteState();
  const viewedThreadIdRef = useRef(viewedThreadId);
  useEffect(() => {
    viewedThreadIdRef.current = viewedThreadId;
  }, [viewedThreadId]);
  const closePanesForThreads = useSetAtom(closePanesForThreadsAtom);
  const restoreClosedPanes = useSetAtom(restoreClosedPanesAtom);
  const archiveThreadAndChildrenMutation = useArchiveThreadAndChildren();
  const unarchiveThreadMutation = useUnarchiveThread();
  const markThreadRead = useMarkThreadRead();
  const markThreadUnread = useMarkThreadUnread();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const deleteThread = useDeleteThread();
  const updateThread = useUpdateThread();
  const inlineRenameThread = useUpdateThread({ showErrorToast: false });
  const threadActionContextAbortRef = useRef<AbortController | null>(null);
  const { mutateAsync: archiveThreadAndChildrenMutateAsync } =
    archiveThreadAndChildrenMutation;
  const { mutateAsync: deleteMutateAsync } = deleteThread;
  const { mutate: unarchiveMutate } = unarchiveThreadMutation;
  const { mutate: markReadMutate } = markThreadRead;
  const { mutate: markUnreadMutate } = markThreadUnread;
  const { mutate: pinMutate } = pinThread;
  const { mutate: unpinMutate } = unpinThread;
  const { mutate: updateMutate } = updateThread;
  const { mutateAsync: inlineRenameMutateAsync } = inlineRenameThread;

  const renameDialog = useDialogState<ThreadRenameDialogTarget>();
  const deleteDialog = useDialogState<ThreadDeleteDialogTarget>();
  const archiveDialog = useDialogState<ThreadArchiveDialogTarget>();

  const { onClose: closeRenameDialog, onOpen: openRenameDialog } = renameDialog;
  const {
    onClose: closeDeleteDialog,
    onOpen: openDeleteDialog,
    setTarget: setDeleteDialogTarget,
  } = deleteDialog;
  const { onClose: closeArchiveDialog, onOpen: openArchiveDialog } =
    archiveDialog;

  useEffect(() => {
    return () => {
      threadActionContextAbortRef.current?.abort();
      threadActionContextAbortRef.current = null;
    };
  }, []);

  const navigateAwayIfViewing = useCallback(
    (thread: Thread) => {
      if (viewedThreadIdRef.current === thread.id) {
        navigate(getRootComposeRoutePath());
      }
    },
    [navigate],
  );

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

  const renameThreadAsync = useCallback(
    async (threadId: string, title: string) => {
      await inlineRenameMutateAsync({ id: threadId, title });
    },
    [inlineRenameMutateAsync],
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
        showMutationErrorToast({
          error,
          fallbackMessage: "Failed to check thread state",
        });
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
      closeDialog();
      const deleteDisplacedThread = viewedThreadIdRef.current === thread.id;
      const closeResult = closePanesForThreads([thread.id]);
      const deleteDestination =
        deleteDisplacedThread &&
        closeResult.removedAny &&
        closeResult.focusedRoute !== null
          ? getThreadRoutePath(closeResult.focusedRoute)
          : deleteDisplacedThread
            ? getRootComposeRoutePath()
            : null;
      syncNavigationAfterClose(closeResult, () =>
        navigateAwayIfViewing(thread),
      );
      if (deleteDestination !== null) {
        viewedRouteRef.current = deleteDestination;
      }
      deleteMutateAsync({ id: thread.id, childThreadsConfirmed }).then(
        () => {
          destroyPersistedBrowserViewsForThread({
            desktopBrowser: getDesktopBrowserApi(),
            threadId: thread.id,
          });
        },
        () => {
          restoreClosedPanes(closeResult);
          if (
            deleteDestination !== null &&
            viewedRouteRef.current === deleteDestination
          ) {
            navigate(
              getThreadRoutePath({
                projectId: thread.projectId,
                threadId: thread.id,
              }),
            );
          }
        },
      );
    },
    [
      closePanesForThreads,
      deleteMutateAsync,
      navigate,
      navigateAwayIfViewing,
      restoreClosedPanes,
      syncNavigationAfterClose,
    ],
  );

  const requestDelete = useCallback(
    async (thread: Thread) => {
      const controller = claimThreadActionContextAbortController();
      const cachedChildThreadCount = countCachedLiveChildThreads({
        queryClient,
        threadId: thread.id,
      });
      const openedTarget: ThreadDeleteDialogTarget | null =
        cachedChildThreadCount === null
          ? null
          : {
              thread,
              childSummaryPending: cachedChildThreadCount === 0,
              ...(cachedChildThreadCount > 0
                ? { childThreadCount: cachedChildThreadCount }
                : {}),
            };
      if (openedTarget !== null) {
        openDeleteDialog(openedTarget);
      }
      const context = await loadThreadActionContext(thread, controller.signal);
      if (controller.signal.aborted) {
        if (openedTarget?.childSummaryPending) {
          setDeleteDialogTarget((current) =>
            current === openedTarget ? null : current,
          );
        }
        return;
      }
      if (threadActionContextAbortRef.current === controller) {
        threadActionContextAbortRef.current = null;
      }
      if (context === null) {
        if (cachedChildThreadCount === 0) {
          setDeleteDialogTarget((current) =>
            current?.thread.id === thread.id ? null : current,
          );
        } else if (cachedChildThreadCount !== null) {
          setDeleteDialogTarget((current) =>
            current?.thread.id === thread.id
              ? { ...current, childSummaryPending: false }
              : current,
          );
        }
        return;
      }
      const target = buildDialogTargetFromContext(
        { thread, childSummaryPending: false },
        context,
      );
      if (cachedChildThreadCount === null) {
        openDeleteDialog(target);
        return;
      }
      setDeleteDialogTarget((current) =>
        current?.thread.id === thread.id ? target : current,
      );
    },
    [
      claimThreadActionContextAbortController,
      loadThreadActionContext,
      openDeleteDialog,
      queryClient,
      setDeleteDialogTarget,
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

  const performArchive = useCallback(
    ({ childThreadsConfirmed, closeDialog, thread }: ArchiveThreadActionRequest) => {
      closeDialog?.();
      const outcome: ArchiveOutcome = {
        archivedThreadIds: getCachedArchiveThreadIds({
          queryClient,
          threadId: thread.id,
        }),
        settled: false,
        undoRequested: false,
      };
      const archiveDisplacedThread = viewedThreadIdRef.current === thread.id;
      const closeResult = closePanesForThreads(outcome.archivedThreadIds);
      let additionalCloseResult: ClosePanesForThreadsResult | null = null;
      const restoreArchivedPanes = () => {
        if (additionalCloseResult !== null) {
          restoreClosedPanes(additionalCloseResult);
        }
        restoreClosedPanes(closeResult);
      };
      const archiveDestination =
        archiveDisplacedThread &&
        closeResult.removedAny &&
        closeResult.focusedRoute !== null
          ? getThreadRoutePath(closeResult.focusedRoute)
          : archiveDisplacedThread
            ? getRootComposeRoutePath()
            : null;
      const navigateAwayIfArchived = (archivedThreadIds: readonly string[]) => {
        const viewed = viewedThreadIdRef.current;
        if (viewed && archivedThreadIds.includes(viewed)) {
          navigate(getRootComposeRoutePath());
        }
      };
      syncNavigationAfterClose(closeResult, () =>
        navigateAwayIfArchived(outcome.archivedThreadIds),
      );
      if (archiveDestination !== null) {
        viewedRouteRef.current = archiveDestination;
      }
      const threadRoutePath = getThreadRoutePath({
        projectId: thread.projectId,
        threadId: thread.id,
      });
      const unarchiveThreads = (archivedThreadIds: readonly string[]) => {
        for (const threadId of [...archivedThreadIds].reverse()) {
          unarchiveMutate({ id: threadId });
        }
      };
      const toastId = `thread-archived-${thread.id}`;
      const showArchivedToast = () => {
        appToast.success("Thread Archived", {
          description: (
            <ArchivedThreadToastDescription
              archivedThreadCount={outcome.archivedThreadIds.length}
              threadTitle={getThreadDisplayTitle(thread)}
              onOpenThread={() => {
                navigate(threadRoutePath);
                appToast.dismiss(toastId);
              }}
            />
          ),
          cancel: {
            label: "Undo",
            onClick: () => {
              const shouldReturnToThread =
                archiveDestination !== null &&
                viewedRouteRef.current === archiveDestination;
              if (outcome.settled) {
                unarchiveThreads(outcome.archivedThreadIds);
              } else {
                outcome.undoRequested = true;
              }
              restoreArchivedPanes();
              if (shouldReturnToThread) {
                navigate(threadRoutePath);
              }
            },
          },
          duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
          id: toastId,
        });
      };
      showArchivedToast();
      archiveThreadAndChildrenMutateAsync({
        id: thread.id,
        childThreadsConfirmed,
      }).then(
        (response) => {
          const optimisticThreadIds = outcome.archivedThreadIds;
          outcome.archivedThreadIds = response.archivedThreadIds;
          outcome.settled = true;
          if (outcome.undoRequested) {
            unarchiveThreads(response.archivedThreadIds);
            return;
          }
          const unexpectedThreadIds = response.archivedThreadIds.filter(
            (threadId) => !optimisticThreadIds.includes(threadId),
          );
          if (unexpectedThreadIds.length > 0) {
            additionalCloseResult = closePanesForThreads(unexpectedThreadIds);
            syncNavigationAfterClose(additionalCloseResult, () =>
              navigateAwayIfArchived(unexpectedThreadIds),
            );
          }
          if (response.archivedThreadIds.length !== optimisticThreadIds.length) {
            showArchivedToast();
          }
        },
        (error: unknown) => {
          outcome.archivedThreadIds = [];
          outcome.settled = true;
          appToast.dismiss(toastId);
          restoreArchivedPanes();
          if (
            archiveDestination !== null &&
            viewedRouteRef.current === archiveDestination
          ) {
            navigate(threadRoutePath);
          }
          if (error instanceof ArchiveThreadConfirmationRequired) {
            openArchiveDialog({
              thread,
              childThreadCount: error.childThreadCount,
            });
            return;
          }
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to archive thread and children",
            lifecycleOperation: "archive_thread",
          });
        },
      );
    },
    [
      archiveThreadAndChildrenMutateAsync,
      openArchiveDialog,
      closePanesForThreads,
      navigate,
      queryClient,
      restoreClosedPanes,
      syncNavigationAfterClose,
      unarchiveMutate,
    ],
  );

  const requestArchive = useCallback(
    (thread: Thread) => {
      threadActionContextAbortRef.current?.abort();
      threadActionContextAbortRef.current = null;
      const cachedDescendantIds = getCachedUnarchivedDescendantIds({
        queryClient,
        threadId: thread.id,
      });
      if (cachedDescendantIds !== null && cachedDescendantIds.length > 0) {
        openArchiveDialog({
          thread,
          childThreadCount: cachedDescendantIds.length,
        });
        return;
      }
      performArchive({ thread, childThreadsConfirmed: false });
    },
    [openArchiveDialog, performArchive, queryClient],
  );

  const confirmArchive = useCallback(
    (target: ThreadArchiveDialogTarget) => {
      performArchive({
        childThreadsConfirmed: true,
        closeDialog: closeArchiveDialog,
        thread: target.thread,
      });
    },
    [closeArchiveDialog, performArchive],
  );

  const toggleRead = useCallback(
    (thread: Thread) => {
      if (getThreadReadToggleAction(thread) === "mark_unread") {
        markUnreadMutate(
          { threadId: thread.id },
          {
            onError: (error) => {
              showMutationErrorToast({
                error,
                fallbackMessage: "Failed to mark thread unread",
              });
            },
          },
        );
        return;
      }
      markReadMutate(
        { threadId: thread.id },
        {
          onError: (error) => {
            showMutationErrorToast({
              error,
              fallbackMessage: "Failed to mark thread read",
            });
          },
        },
      );
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
      renameThreadAsync,
      requestRename,
      requestArchive,
      requestDelete,
      unarchiveThread: unarchiveThreadAction,
      togglePin,
      toggleRead,
    }),
    [
      renameThreadAsync,
      requestArchive,
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
      <ThreadArchiveDialog
        target={archiveDialog.target}
        pending={archiveThreadAndChildrenMutation.isPending}
        onOpenChange={archiveDialog.onOpenChange}
        onArchive={confirmArchive}
      />
    </ThreadActionsContext.Provider>
  );
}
