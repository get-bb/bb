import { useLayoutEffect, useMemo, useRef } from "react";
import { useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  type PluginThreadActionRegistration,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { useRouteState } from "@/hooks/useRouteState";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { lookupCachedThread } from "@/lib/plugin-sidebar-hooks";
import { getThreadRoutePath } from "@/lib/route-paths";
import { countPanes, listPanes } from "@/lib/split-layout";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";

function coreThreadAction<Data>(
  registration: PluginThreadActionRegistration<Data>,
): PluginThreadActionRegistration<unknown> {
  return registration;
}

export function getThreadUrl(thread: PluginThreadActionTarget): string {
  return new URL(
    getThreadRoutePath({ projectId: thread.projectId, threadId: thread.id }),
    window.location.origin,
  ).toString();
}

interface SplitAvailability {
  available: boolean;
  openThreadIds: ReadonlySet<string>;
}

function useSplitAvailability(): SplitAvailability {
  const isCompact = useIsCompactViewport();
  const layout = useAtomValue(splitLayoutAtom);
  const { threadId } = useRouteState();
  const openThreadIdsKey =
    layout !== null && countPanes(layout.root) > 1
      ? listPanes(layout.root)
          .flatMap((pane) =>
            pane.content.kind === "thread" ? [pane.content.threadId] : [],
          )
          .join("\n")
      : (threadId ?? "");
  return useMemo(
    () => ({
      available: !isCompact,
      openThreadIds: new Set(
        openThreadIdsKey === "" ? [] : openThreadIdsKey.split("\n"),
      ),
    }),
    [isCompact, openThreadIdsKey],
  );
}

function afterMenuCloses(run: () => void): void {
  window.setTimeout(run, 0);
}

interface LifecycleHandlers {
  archive: (threadId: string) => void;
  requestDelete: (threadId: string) => void;
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
      archive: (threadId: string) => {
        const thread = lookupCachedThread(queryClient, threadId);
        if (thread !== null) latest.current.requestArchive(thread);
      },
      requestDelete: (threadId: string) => {
        const thread = lookupCachedThread(queryClient, threadId);
        if (thread !== null) latest.current.requestDelete(thread);
      },
    }),
    [queryClient],
  );
}

export const CORE_THREAD_ACTIONS: readonly PluginThreadActionRegistration<unknown>[] =
  [
    coreThreadAction({
      id: "split",
      group: GROUPS.open,
      title: "Open in split",
      icon: "Columns2",
      useData: useSplitAvailability,
      item: ({ thread, data, navigate }) =>
        !data.available || data.openThreadIds.has(thread.id)
          ? null
          : {
              label: "Open in split",
              icon: "Columns2",
              run: () => navigate.toThread(thread.id, { split: true }),
            },
    }),
    coreThreadAction({
      id: "newThreadInEnvironment",
      group: GROUPS.organize,
      order: 10,
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
    }),
    coreThreadAction({
      id: "copyLink",
      group: GROUPS.organize,
      order: 20,
      title: "Copy thread link",
      icon: "Copy",
      item: ({ thread }) => ({
        label: "Copy thread link",
        icon: "Copy",
        run: () =>
          copyToClipboardWithToast(getThreadUrl(thread), {
            successMessage: "Thread link copied",
            errorMessage: "Failed to copy thread link",
          }).then(() => undefined),
      }),
    }),
    coreThreadAction({
      id: "read",
      group: GROUPS.organize,
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
    }),
    coreThreadAction({
      id: "pin",
      group: GROUPS.organize,
      order: 40,
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
    }),
    coreThreadAction({
      id: "rename",
      group: GROUPS.organize,
      order: 60,
      title: "Rename",
      icon: "Edit",
      item: ({ thread }) => ({
        label: "Rename",
        icon: "Edit",
        run: ({ requestRename }) => requestRename(thread.id),
      }),
    }),
    coreThreadAction({
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
              afterMenuCloses(() => data.archive(thread.id));
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
    }),
    coreThreadAction({
      id: "delete",
      group: GROUPS.lifecycle,
      title: "Delete",
      icon: "Trash2",
      useData: useLifecycleHandlers,
      item: ({ thread, data }) => ({
        label: "Delete",
        icon: "Trash2",
        variant: "destructive",
        run: () => afterMenuCloses(() => data.requestDelete(thread.id)),
      }),
    }),
  ];
