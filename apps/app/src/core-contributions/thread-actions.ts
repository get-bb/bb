import { useMemo } from "react";
import { toast } from "sonner";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  type PluginThreadAction,
  type PluginThreadActionItemInput,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_copyToClipboard,
  experimental_showErrorToast,
  useBbContext,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";

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
    experimental_showErrorToast({ error: failure.reason, fallbackMessage });
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

export default definePluginApp((app) => {
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
    item: ({ thread, navigate }) => ({
      label: "Copy link",
      icon: "Copy",
      run: async () => {
        const url = new URL(
          navigate.experimental_threadHref(thread.id),
          window.location.origin,
        ).toString();
        if (await experimental_copyToClipboard({ text: url })) {
          toast.success("Thread link copied");
        } else {
          toast.error("Failed to copy thread link");
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
          experimental_showErrorToast({
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
      if (thread.isHidden && !isPinned) return null;
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
            experimental_showErrorToast({
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
            experimental_showErrorToast({
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
        const toastId = toast.loading("Regenerating title");
        try {
          await sdk.threads.experimental_regenerateTitle({
            threadId: thread.id,
          });
          toast.dismiss(toastId);
        } catch (error) {
          toast.dismiss(toastId);
          experimental_showErrorToast({
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
    item: ({ thread, sdk, threadRequests }) => {
      const isArchived = thread.archivedAt !== null;
      return {
        label: isArchived ? "Unarchive" : "Archive",
        icon: isArchived ? "ArchiveRestore" : "Archive",
        run: async () => {
          if (!isArchived) {
            afterMenuCloses(
              () => void threadRequests.requestArchive([thread.id]),
            );
            return;
          }
          try {
            await sdk.threads.unarchive({ threadId: thread.id });
          } catch (error) {
            experimental_showErrorToast({
              error,
              fallbackMessage: "Failed to unarchive thread.",
            });
          }
        },
      };
    },
    experimental_bulkItem: ({ threads, sdk, threadRequests }) => {
      const active = threads.filter((thread) => thread.archivedAt === null);
      if (active.length > 0) {
        return {
          label: `Archive ${describeThreadCount(active.length)}`,
          icon: "Archive",
          run: () =>
            afterMenuCloses(
              () =>
                void threadRequests.requestArchive(
                  active.map((thread) => thread.id),
                ),
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
            experimental_showErrorToast({
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
    item: ({ thread, threadRequests }) => ({
      label: "Delete",
      icon: "Trash2",
      variant: "destructive",
      run: () =>
        afterMenuCloses(() => void threadRequests.requestDelete([thread.id])),
    }),
    experimental_bulkItem: ({ threads, threadRequests }) => ({
      label: `Delete ${describeThreadCount(threads.length)}`,
      icon: "Trash2",
      variant: "destructive",
      run: () =>
        afterMenuCloses(
          () =>
            void threadRequests.requestDelete(
              threads.map((thread) => thread.id),
            ),
        ),
    }),
  });
});
