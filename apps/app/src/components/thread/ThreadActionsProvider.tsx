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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { appToast } from "@/components/ui/app-toast";
import {
  closePanesForThreadsAtom,
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
import { sdk } from "@/lib/sdk";
import { getPluginBoundSdk } from "@/lib/plugin-bound-sdk";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { useDialogState } from "@bb/shared-ui/use-dialog-state";
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
import { resolveThread } from "@/lib/cached-thread";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { ThreadActionCollectors } from "@/lib/thread-actions/thread-action-registry";
import { planThreadSelection } from "@/lib/thread-selection-plan";
import type { ThreadCascadeAction } from "@bb/server-contract";

export interface ThreadActionsContextValue {
  archiveEnvironmentThreads: (environmentId: string) => Promise<void>;
  requestArchive: (thread: Thread) => void;
  requestArchiveThreads: (threads: readonly Thread[]) => void;
  renameThreadAsync: (threadId: string, title: string) => Promise<void>;
  requestRename: (thread: Thread) => void;
  requestDelete: (thread: Thread) => void;
  requestDeleteThreads: (threads: readonly Thread[]) => void;
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

interface ArchiveDialogRequest extends ThreadArchiveDialogTarget {
  roots: readonly Thread[];
}

interface DeleteDialogRequest extends ThreadDeleteDialogTarget {
  roots: readonly Thread[];
  cascadeThreadIdsByRootId: ReadonlyMap<string, readonly string[]>;
}

function describeThreadCount(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

const ARCHIVE_UNDO_TOAST_DURATION_MS = 10_000;

export function ThreadActionsProvider({
  children,
}: ThreadActionsProviderProps) {
  const confirmThreadArchive =
    useSystemConfig().data?.generalSettings.confirmThreadArchive ?? true;
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
  const { mutate: unarchiveMutate } = unarchiveThreadMutation;
  const { mutate: markReadMutate } = markThreadRead;
  const { mutate: markUnreadMutate } = markThreadUnread;
  const { mutate: pinMutate } = pinThread;
  const { mutate: unpinMutate } = unpinThread;
  const { mutateAsync: deleteMutateAsync } = deleteThread;
  const { mutate: updateMutate } = updateThread;
  const { mutateAsync: inlineRenameMutateAsync } = inlineRenameThread;

  const renameDialog = useDialogState<ThreadRenameDialogTarget>();
  const deleteDialog = useDialogState<DeleteDialogRequest>();
  const archiveDialog = useDialogState<ArchiveDialogRequest>();

  const { onClose: closeRenameDialog, onOpen: openRenameDialog } = renameDialog;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;
  const { onClose: closeArchiveDialog, onOpen: openArchiveDialog } =
    archiveDialog;

  useEffect(() => {
    return () => {
      threadActionContextAbortRef.current?.abort();
      threadActionContextAbortRef.current = null;
    };
  }, []);

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

  const claimThreadActionContextAbortController =
    useCallback((): AbortController => {
      threadActionContextAbortRef.current?.abort();
      const controller = new AbortController();
      threadActionContextAbortRef.current = controller;
      return controller;
    }, []);

  const claimSelectionPlan = useCallback(
    async (threads: readonly Thread[], action: ThreadCascadeAction) => {
      const controller = claimThreadActionContextAbortController();
      try {
        const plan = await planThreadSelection({
          threads,
          action,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return null;
        if (threadActionContextAbortRef.current === controller) {
          threadActionContextAbortRef.current = null;
        }
        return plan;
      } catch (error) {
        if (controller.signal.aborted) return null;
        showMutationErrorToast({
          error,
          fallbackMessage: "Failed to check thread state",
        });
        return null;
      }
    },
    [claimThreadActionContextAbortController],
  );

  const performDeleteThreads = useCallback(
    async (request: DeleteDialogRequest) => {
      const results = await Promise.allSettled(
        request.roots.map((root) =>
          deleteMutateAsync({ id: root.id, childThreadsConfirmed: true }),
        ),
      );
      const removedThreadIds = request.roots.flatMap((root, index) =>
        results[index]?.status === "fulfilled"
          ? [root.id, ...(request.cascadeThreadIdsByRootId.get(root.id) ?? [])]
          : [],
      );
      if (removedThreadIds.length > 0) closeDeleteDialog();
      for (const threadId of removedThreadIds) {
        destroyPersistedBrowserViewsForThread({
          desktopBrowser: getDesktopBrowserApi(),
          threadId,
        });
      }
      if (removedThreadIds.length === 0) return;
      syncNavigationAfterClose(closePanesForThreads(removedThreadIds), () => {
        const viewed = viewedThreadIdRef.current;
        if (viewed !== undefined && removedThreadIds.includes(viewed)) {
          navigate(getRootComposeRoutePath());
        }
      });
    },
    [
      closeDeleteDialog,
      closePanesForThreads,
      deleteMutateAsync,
      navigate,
      syncNavigationAfterClose,
    ],
  );

  const requestDeleteThreads = useCallback(
    async (threads: readonly Thread[]) => {
      if (threads.length === 0) return;
      const plan = await claimSelectionPlan(threads, "delete");
      if (plan === null) return;
      openDeleteDialog({
        threads,
        roots: plan.roots,
        cascadeThreadIdsByRootId: plan.cascadeThreadIdsByRootId,
        ...(plan.childThreadCount > 0
          ? { childThreadCount: plan.childThreadCount }
          : {}),
      });
    },
    [claimSelectionPlan, openDeleteDialog],
  );

  const requestDelete = useCallback(
    (thread: Thread) => void requestDeleteThreads([thread]),
    [requestDeleteThreads],
  );

  const confirmDelete = useCallback(
    (target: DeleteDialogRequest) => void performDeleteThreads(target),
    [performDeleteThreads],
  );

  const unarchiveThreadAction = useCallback(
    (thread: Thread) => {
      unarchiveMutate({ id: thread.id });
    },
    [unarchiveMutate],
  );

  const { mutateAsync: archiveEnvironmentMutateAsync } = useMutation({
    meta: { lifecycleOperation: "archive_thread", showErrorToast: false },
    mutationFn: (environmentId: string) =>
      getPluginBoundSdk(
        sdk,
        "thread-list",
        queryClient,
      ).environments.archiveThreads({ environmentId }),
  });

  const presentArchivedThreads = useCallback(
    (archivedThreadIds: readonly string[], toastId: string) => {
      const browserSdk = getPluginBoundSdk(sdk, "thread-list", queryClient);
      const displacedThreadId = viewedThreadIdRef.current;
      const displaced =
        displacedThreadId !== undefined &&
        archivedThreadIds.includes(displacedThreadId);
      const closeResult = closePanesForThreads([...archivedThreadIds]);
      syncNavigationAfterClose(closeResult, () => {
        const viewed = viewedThreadIdRef.current;
        if (viewed && archivedThreadIds.includes(viewed))
          navigate(getRootComposeRoutePath());
      });
      const destination = displaced
        ? closeResult.focusedRoute !== null
          ? getThreadRoutePath(closeResult.focusedRoute)
          : getRootComposeRoutePath()
        : null;
      const previousRoute = viewedRouteRef.current;
      if (destination !== null) viewedRouteRef.current = destination;
      appToast.success(
        archivedThreadIds.length === 1 ? "Thread archived" : "Threads archived",
        {
          description: `Archived ${describeThreadCount(archivedThreadIds.length)}`,
          cancel: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                try {
                  for (const threadId of [...archivedThreadIds].reverse())
                    await browserSdk.threads.unarchive({ threadId });
                  if (
                    destination !== null &&
                    viewedRouteRef.current === destination
                  )
                    navigate(previousRoute);
                } catch (error) {
                  showMutationErrorToast({
                    error,
                    fallbackMessage: "Failed to restore archived threads",
                  });
                }
              })();
            },
          },
          duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
          id: toastId,
        },
      );
    },
    [queryClient, closePanesForThreads, syncNavigationAfterClose, navigate],
  );

  const archiveEnvironmentThreads = useCallback(
    async (environmentId: string) => {
      try {
        const response = await archiveEnvironmentMutateAsync(environmentId);
        if (response.archivedThreadIds.length === 0) return;
        presentArchivedThreads(
          response.archivedThreadIds,
          `environment-archived-${environmentId}`,
        );
      } catch (error) {
        showMutationErrorToast({
          error,
          fallbackMessage: "Failed to archive environment threads",
        });
        throw error;
      }
    },
    [archiveEnvironmentMutateAsync, presentArchivedThreads],
  );

  const performArchiveThreads = useCallback(
    async (roots: readonly Thread[]) => {
      const results = await Promise.allSettled(
        roots.map((root) =>
          archiveThreadAndChildrenMutateAsync({
            id: root.id,
            childThreadsConfirmed: true,
          }),
        ),
      );
      closeArchiveDialog();
      const failure = results.find((result) => result.status === "rejected");
      if (failure !== undefined) {
        showMutationErrorToast({
          error: failure.reason,
          fallbackMessage: "Failed to archive some threads",
          lifecycleOperation: "archive_thread",
        });
      }
      const archivedThreadIds = [
        ...new Set(
          results.flatMap((result) =>
            result.status === "fulfilled" ? result.value.archivedThreadIds : [],
          ),
        ),
      ];
      if (archivedThreadIds.length === 0) return;
      presentArchivedThreads(
        archivedThreadIds,
        `threads-archived-${roots.map((root) => root.id).join("-")}`,
      );
    },
    [
      archiveThreadAndChildrenMutateAsync,
      closeArchiveDialog,
      presentArchivedThreads,
    ],
  );

  const performArchive = useCallback(
    ({
      childThreadsConfirmed,
      closeDialog,
      thread,
    }: ArchiveThreadActionRequest) => {
      archiveThreadAndChildrenMutateAsync({
        id: thread.id,
        childThreadsConfirmed,
      }).then(
        (response) => {
          closeDialog?.();
          const viewedThreadId = viewedThreadIdRef.current;
          const archiveDisplacedThread = viewedThreadId === thread.id;
          const closeResult = closePanesForThreads(response.archivedThreadIds);
          const archiveDestination =
            archiveDisplacedThread &&
            closeResult.removedAny &&
            closeResult.focusedRoute !== null
              ? getThreadRoutePath(closeResult.focusedRoute)
              : archiveDisplacedThread
                ? getRootComposeRoutePath()
                : null;
          const navigateAwayIfArchived = () => {
            const viewed = viewedThreadIdRef.current;
            if (viewed && response.archivedThreadIds.includes(viewed)) {
              navigate(getRootComposeRoutePath());
            }
          };
          syncNavigationAfterClose(closeResult, navigateAwayIfArchived);
          if (archiveDestination !== null) {
            viewedRouteRef.current = archiveDestination;
          }
          const toastId = `thread-archived-${thread.id}`;
          appToast.success("Thread archived", {
            description: (
              <ArchivedThreadToastDescription
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
              />
            ),
            cancel: {
              label: "Undo",
              onClick: () => {
                const shouldReturnToThread =
                  archiveDestination !== null &&
                  viewedRouteRef.current === archiveDestination;
                for (const threadId of [
                  ...response.archivedThreadIds,
                ].reverse()) {
                  unarchiveMutate({ id: threadId });
                }
                if (shouldReturnToThread) {
                  navigate(
                    getThreadRoutePath({
                      projectId: thread.projectId,
                      threadId: thread.id,
                    }),
                  );
                }
              },
            },
            duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
            id: toastId,
          });
        },
        (error: unknown) => {
          if (error instanceof ArchiveThreadConfirmationRequired) {
            openArchiveDialog({
              threads: [thread],
              roots: [thread],
              childThreadCount: error.childThreadCount,
            });
            return;
          }
          closeDialog?.();
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to archive thread and its child threads",
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
      syncNavigationAfterClose,
      unarchiveMutate,
    ],
  );

  const requestArchiveThreads = useCallback(
    async (threads: readonly Thread[]) => {
      const [first] = threads;
      if (first === undefined) return;
      if (threads.length === 1) {
        performArchive({
          thread: first,
          childThreadsConfirmed: !confirmThreadArchive,
        });
        return;
      }
      const active = threads.filter((thread) => thread.archivedAt === null);
      if (active.length === 0) return;
      const plan = await claimSelectionPlan(active, "archive");
      if (plan === null) return;
      if (!confirmThreadArchive || plan.childThreadCount === 0) {
        await performArchiveThreads(plan.roots);
        return;
      }
      openArchiveDialog({
        threads: active,
        roots: plan.roots,
        childThreadCount: plan.childThreadCount,
      });
    },
    [
      claimSelectionPlan,
      confirmThreadArchive,
      openArchiveDialog,
      performArchive,
      performArchiveThreads,
    ],
  );

  const requestArchive = useCallback(
    (thread: Thread) => void requestArchiveThreads([thread]),
    [requestArchiveThreads],
  );

  const confirmArchive = useCallback(
    (target: ArchiveDialogRequest) => {
      const [only] = target.threads;
      if (target.threads.length === 1 && only !== undefined) {
        performArchive({
          childThreadsConfirmed: true,
          closeDialog: closeArchiveDialog,
          thread: only,
        });
        return;
      }
      void performArchiveThreads(target.roots);
    },
    [closeArchiveDialog, performArchive, performArchiveThreads],
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
      archiveEnvironmentThreads,
      renameThreadAsync,
      requestRename,
      requestArchive,
      requestArchiveThreads,
      requestDelete,
      requestDeleteThreads,
      unarchiveThread: unarchiveThreadAction,
      togglePin,
      toggleRead,
    }),
    [
      archiveEnvironmentThreads,
      renameThreadAsync,
      requestArchive,
      requestArchiveThreads,
      requestRename,
      requestDelete,
      requestDeleteThreads,
      togglePin,
      toggleRead,
      unarchiveThreadAction,
    ],
  );

  const requestRenameById = (threadId: string) => {
    resolveThread(queryClient, threadId).then(
      (thread) => window.setTimeout(() => requestRename(thread), 0),
      (error: unknown) =>
        showMutationErrorToast({
          error,
          fallbackMessage: "Failed to rename thread.",
        }),
    );
  };

  return (
    <ThreadActionsContext.Provider value={value}>
      <ThreadActionCollectors
        coreRegistrations={CORE_THREAD_ACTIONS}
        requestRename={requestRenameById}
      />
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
