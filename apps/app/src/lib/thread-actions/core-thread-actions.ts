import { useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  type PluginThreadAction,
  type PluginThreadActionItemInput,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_copyToClipboard,
  useBbContext,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { collectCoreContributionSlots } from "@/lib/core-contributions";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { appToast } from "@/components/ui/app-toast";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { resolveThread } from "@/lib/cached-thread";
import { getThreadRoutePath } from "@/lib/route-paths";

export function getThreadUrl(thread: PluginThreadActionTarget): string {
  return new URL(
    getThreadRoutePath({ projectId: thread.projectId, threadId: thread.id }),
    window.location.origin,
  ).toString();
}

interface SplitAvailability {
  available: boolean;
  focusedThreadId: string | null;
  otherPaneThreadIds: ReadonlySet<string>;
}

function useSplitAvailability(): SplitAvailability {
  const isCompact = useIsCompactViewport();
  const layout = useSidebarSplitLayout();
  const { threadId } = useBbContext();
  const panes = layout?.panes ?? [];
  const focusedPane = panes.find((pane) => pane.isFocused);
  const focusedThreadId =
    panes.length === 0 ? threadId : (focusedPane?.threadId ?? null);
  const otherPaneThreadIdsKey = panes
    .flatMap((pane) =>
      pane !== focusedPane && pane.threadId !== null ? [pane.threadId] : [],
    )
    .join("\n");
  return useMemo(
    () => ({
      available: !isCompact,
      focusedThreadId,
      otherPaneThreadIds: new Set(
        otherPaneThreadIdsKey === "" ? [] : otherPaneThreadIdsKey.split("\n"),
      ),
    }),
    [focusedThreadId, isCompact, otherPaneThreadIdsKey],
  );
}

function afterMenuCloses(run: () => void): void {
  window.setTimeout(run, 0);
}

function describeThreadCount(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

async function runForEach(
  threads: readonly PluginThreadActionTarget[],
  run: (thread: PluginThreadActionTarget) => Promise<unknown>,
  fallbackMessage: string,
): Promise<void> {
  const results = await Promise.allSettled(threads.map(run));
  const failure = results.find((result) => result.status === "rejected");
  if (failure !== undefined) {
    showMutationErrorToast({ error: failure.reason, fallbackMessage });
  }
}

type ParentNotifications = PluginThreadActionTarget["parentNotifications"];

const PARENT_NOTIFICATIONS_LABELS = {
  auto: "Auto",
  stuck: "When stuck",
  off: "Off",
} satisfies Record<ParentNotifications, string>;

function isParentNotifications(
  value: string | undefined,
): value is ParentNotifications {
  return (
    value !== undefined && Object.hasOwn(PARENT_NOTIFICATIONS_LABELS, value)
  );
}

const PARENT_NOTIFICATIONS_VALUES = Object.keys(
  PARENT_NOTIFICATIONS_LABELS,
).filter(isParentNotifications);

function parentNotificationsAction(
  threads: readonly PluginThreadActionTarget[],
  children: readonly PluginThreadActionTarget[],
  sdk: PluginThreadActionItemInput<unknown>["sdk"],
): PluginThreadAction | null {
  const [first] = children;
  if (first === undefined) return null;
  const shared = children.every(
    (thread) => thread.parentNotifications === first.parentNotifications,
  )
    ? first.parentNotifications
    : null;
  return {
    label: "Notify parent",
    detail: shared === null ? "Mixed" : PARENT_NOTIFICATIONS_LABELS[shared],
    icon: "Megaphone02",
    choices: {
      ...(children.length < threads.length
        ? {
            hint: `Applies to ${describeThreadCount(children.length)} with a parent`,
          }
        : {}),
      items: PARENT_NOTIFICATIONS_VALUES.map((parentNotifications) => ({
        id: parentNotifications,
        label: PARENT_NOTIFICATIONS_LABELS[parentNotifications],
        selected: parentNotifications === shared,
      })),
    },
    run: async ({ value }) => {
      if (!isParentNotifications(value)) return;
      const parentNotifications = value;
      await runForEach(
        children.filter(
          (thread) => thread.parentNotifications !== parentNotifications,
        ),
        (thread) =>
          sdk.threads.update({
            threadId: thread.id,
            parentNotifications,
          }),
        children.length === 1
          ? "Failed to change parent notifications."
          : "Failed to change parent notifications for some threads.",
      );
    },
  };
}

function childThreads(
  threads: readonly PluginThreadActionTarget[],
): PluginThreadActionTarget[] {
  return threads.filter((thread) => thread.parentThreadId !== null);
}

interface LifecycleHandlers {
  archive: (threadIds: readonly string[]) => Promise<void>;
  requestDelete: (threadIds: readonly string[]) => Promise<void>;
}

function useLifecycleHandlers(): LifecycleHandlers {
  const actions = useThreadActions();
  const queryClient = useQueryClient();
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  return useMemo(
    () => ({
      archive: async (threadIds: readonly string[]) => {
        try {
          latest.current.requestArchiveThreads(
            await Promise.all(
              threadIds.map((threadId) => resolveThread(queryClient, threadId)),
            ),
          );
        } catch (error) {
          showMutationErrorToast({
            error,
            fallbackMessage:
              threadIds.length === 1
                ? "Failed to archive thread."
                : "Failed to archive threads.",
          });
        }
      },
      requestDelete: async (threadIds: readonly string[]) => {
        try {
          latest.current.requestDeleteThreads(
            await Promise.all(
              threadIds.map((threadId) => resolveThread(queryClient, threadId)),
            ),
          );
        } catch (error) {
          showMutationErrorToast({
            error,
            fallbackMessage:
              threadIds.length === 1
                ? "Failed to delete thread."
                : "Failed to delete threads.",
          });
        }
      },
    }),
    [queryClient],
  );
}

const coreThreadActions = definePluginApp((app) => {
  app.slots.experimental_threadAction({
    id: "split",
    group: GROUPS.open,
    order: 10,
    title: "Open in split",
    icon: "Columns2",
    useData: useSplitAvailability,
    item: ({ thread, data, navigate }) =>
      !data.available || data.focusedThreadId === thread.id
        ? null
        : {
            label: data.otherPaneThreadIds.has(thread.id)
              ? "Focus split"
              : "Open in split",
            icon: "Columns2",
            run: () => navigate.toThread(thread.id, { split: true }),
          },
  });
  app.slots.experimental_threadAction({
    id: "newThreadInEnvironment",
    group: GROUPS.open,
    order: 30,
    title: "New thread in environment",
    icon: "MessageSquarePlus",
    useData: useIsCompactViewport,
    item: ({ thread, data: isCompact, navigate }) => {
      const environment = thread.environment;
      if (!isCompact || environment === null || environment.path === null) {
        return null;
      }
      return {
        label: "New thread in environment",
        icon: "MessageSquarePlus",
        run: () =>
          navigate.toCompose({
            projectId: thread.projectId,
            environmentId: environment.id,
            placement: {
              sectionId: thread.sectionId,
              pinned: thread.pinnedAt !== null,
            },
            focusPrompt: true,
          }),
      };
    },
  });
  app.slots.experimental_threadAction({
    id: "copyLink",
    group: GROUPS.open,
    order: 20,
    title: "Copy link",
    icon: "Copy",
    item: ({ thread }) => ({
      label: "Copy link",
      icon: "Copy",
      run: async () => {
        if (
          await experimental_copyToClipboard({ text: getThreadUrl(thread) })
        ) {
          appToast.success("Thread link copied");
        } else {
          appToast.error("Failed to copy thread link");
        }
      },
    }),
  });
  app.slots.experimental_threadAction({
    id: "read",
    group: GROUPS.state,
    order: 30,
    title: "Mark read / unread",
    icon: "MailOpen",
    item: ({ thread, sdk }) => ({
      label: thread.isUnread ? "Mark read" : "Mark unread",
      icon: thread.isUnread ? "MailOpen" : "Mail",
      run: async () => {
        try {
          if (thread.isUnread) {
            await sdk.threads.markRead({ threadId: thread.id });
          } else {
            await sdk.threads.markUnread({ threadId: thread.id });
          }
        } catch (error) {
          showMutationErrorToast({
            error,
            fallbackMessage: thread.isUnread
              ? "Failed to mark thread read"
              : "Failed to mark thread unread",
          });
        }
      },
    }),
    experimental_bulkItem: ({ threads, sdk }) => {
      const anyUnread = threads.some((thread) => thread.isUnread);
      return {
        label: anyUnread ? "Mark read" : "Mark unread",
        icon: anyUnread ? "MailOpen" : "Mail",
        run: () =>
          runForEach(
            threads,
            (thread) =>
              anyUnread
                ? sdk.threads.markRead({ threadId: thread.id })
                : sdk.threads.markUnread({ threadId: thread.id }),
            anyUnread
              ? "Failed to mark threads read"
              : "Failed to mark threads unread",
          ),
      };
    },
  });
  app.slots.experimental_threadAction({
    id: "pin",
    group: GROUPS.state,
    order: 20,
    title: "Pin",
    icon: "Pin",
    item: ({ thread, sdk }) => {
      const isPinned = thread.pinnedAt !== null;
      return {
        label: isPinned ? "Unpin" : "Pin",
        icon: isPinned ? "PinOff" : "Pin",
        run: async () => {
          try {
            if (isPinned) {
              await sdk.threads.unpin({ threadId: thread.id });
            } else {
              await sdk.threads.pin({ threadId: thread.id });
            }
          } catch (error) {
            showMutationErrorToast({
              error,
              fallbackMessage: isPinned
                ? "Failed to unpin thread."
                : "Failed to pin thread.",
            });
          }
        },
      };
    },
    experimental_bulkItem: ({ threads, sdk }) => {
      const allPinned = threads.every((thread) => thread.pinnedAt !== null);
      return {
        label: allPinned ? "Unpin" : "Pin",
        icon: allPinned ? "PinOff" : "Pin",
        run: async () => {
          if (allPinned) {
            await runForEach(
              threads,
              (thread) => sdk.threads.unpin({ threadId: thread.id }),
              "Failed to unpin threads.",
            );
            return;
          }
          try {
            for (const thread of threads
              .filter((candidate) => candidate.pinnedAt === null)
              .reverse()) {
              await sdk.threads.pin({ threadId: thread.id });
            }
          } catch (error) {
            showMutationErrorToast({
              error,
              fallbackMessage: "Failed to pin threads.",
            });
          }
        },
      };
    },
  });
  app.slots.experimental_threadAction({
    id: "parentNotifications",
    group: GROUPS.state,
    order: 60,
    title: "Notify parent",
    icon: "Megaphone02",
    item: ({ thread, sdk }) =>
      parentNotificationsAction([thread], childThreads([thread]), sdk),
    experimental_bulkItem: ({ threads, sdk }) =>
      parentNotificationsAction(threads, childThreads(threads), sdk),
  });
  app.slots.experimental_threadAction({
    id: "rename",
    group: GROUPS.organize,
    order: 10,
    title: "Rename",
    icon: "Edit",
    item: ({ thread }) => ({
      label: "Rename",
      icon: "Edit",
      run: ({ requestRename }) => requestRename(thread.id),
    }),
  });
  app.slots.experimental_threadAction({
    id: "regenerateTitle",
    group: GROUPS.organize,
    order: 20,
    title: "Regenerate title",
    icon: "RotateCcw",
    item: ({ thread, sdk }) => ({
      label: "Regenerate title",
      icon: "RotateCcw",
      run: async () => {
        const toastId = appToast.loading("Regenerating title");
        try {
          await sdk.threads.experimental_regenerateTitle({
            threadId: thread.id,
          });
          appToast.dismiss(toastId);
        } catch (error) {
          appToast.dismiss(toastId);
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to regenerate title.",
          });
        }
      },
    }),
  });
  app.slots.experimental_threadAction({
    id: "archive",
    group: GROUPS.lifecycle,
    title: "Archive",
    icon: "Archive",
    useData: useLifecycleHandlers,
    item: ({ thread, data, sdk }) => {
      const isArchived = thread.archivedAt !== null;
      return {
        label: isArchived ? "Unarchive" : "Archive",
        icon: isArchived ? "ArchiveRestore" : "Archive",
        run: async () => {
          if (!isArchived) {
            afterMenuCloses(() => void data.archive([thread.id]));
            return;
          }
          try {
            await sdk.threads.unarchive({ threadId: thread.id });
          } catch (error) {
            showMutationErrorToast({
              error,
              fallbackMessage: "Failed to unarchive thread.",
            });
          }
        },
      };
    },
    experimental_bulkItem: ({ threads, data, sdk }) => {
      const active = threads.filter((thread) => thread.archivedAt === null);
      if (active.length > 0) {
        return {
          label: `Archive ${describeThreadCount(active.length)}`,
          icon: "Archive",
          run: () =>
            afterMenuCloses(
              () => void data.archive(active.map((thread) => thread.id)),
            ),
        };
      }
      return {
        label: `Unarchive ${describeThreadCount(threads.length)}`,
        icon: "ArchiveRestore",
        run: async () => {
          try {
            for (const thread of threads) {
              await sdk.threads.unarchive({ threadId: thread.id });
            }
          } catch (error) {
            showMutationErrorToast({
              error,
              fallbackMessage: "Failed to unarchive threads.",
            });
          }
        },
      };
    },
  });
  app.slots.experimental_threadAction({
    id: "delete",
    group: GROUPS.lifecycle,
    title: "Delete",
    icon: "Trash2",
    useData: useLifecycleHandlers,
    item: ({ thread, data }) => ({
      label: "Delete",
      icon: "Trash2",
      variant: "destructive",
      run: () => afterMenuCloses(() => void data.requestDelete([thread.id])),
    }),
    experimental_bulkItem: ({ threads, data }) => ({
      label: `Delete ${describeThreadCount(threads.length)}`,
      icon: "Trash2",
      variant: "destructive",
      run: () =>
        afterMenuCloses(
          () => void data.requestDelete(threads.map((thread) => thread.id)),
        ),
    }),
  });
});

export const CORE_THREAD_ACTIONS = collectCoreContributionSlots(
  coreThreadActions,
  "threadActions",
);
