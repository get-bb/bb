import { isThreadRead } from "@bb/client-core";
import type { ThreadResponse } from "@bb/server-contract";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo } from "react";
import { Linking } from "react-native";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { useSidebarBootstrap } from "@/data/sidebar";
import {
  getThreadDisplayTitle,
  useArchiveThread,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  useMoveThreadToSection,
  usePinThread,
  useRenameThread,
  useThreadChildSummary,
  useUnarchiveThread,
  useUnpinThread,
} from "@/data/threads";
import { describeError } from "@/lib/describe-error";
import { shareThreadLink } from "@/lib/share";
import { confirmDestructive, toast, type IconName, type SFSymbol } from "@/ui";
import { buildThreadWebUrl } from "./thread-links";

/**
 * The thread "…" action model (web ThreadActionsMenu plus Copy link / Open
 * in web), shared by its two renderings: the native header menu on iOS
 * (`ThreadHeaderToolbar`) and the bottom sheet on Android
 * (`ThreadActionsSheet`). Labels, keys, icons, order and the mutations
 * live here once; the renderings only decide how Rename and Move present.
 */

export interface ThreadMenuAction {
  key: string;
  label: string;
  /** The Android glyph (and the SF Symbol through the icon map). */
  icon: IconName;
  /** iOS: the exact symbol the header menu shows instead of the mapped one. */
  symbol?: SFSymbol;
  destructive?: boolean;
  disabled?: boolean;
  /** Replaces the icon with a spinner (action in flight). */
  pending?: boolean;
  onPress: () => void;
  testID?: string;
}

export interface ThreadSectionChoice {
  key: string;
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  testID: string;
}

export interface ThreadActionsModel {
  title: string;
  /** Menu rows in order (handoff … delete); Move is a row only with `onMove`. */
  actions: ThreadMenuAction[];
  /** "Move to section" choices: the sidebar sections, then Unorganized. */
  sectionChoices: ThreadSectionChoice[];
  /** False when the sidebar has no sections yet (the choice list is Unorganized only). */
  hasSections: boolean;
  /** Rename mutation for the platform's rename UI. */
  rename: (title: string) => void;
  renamePending: boolean;
}

interface UseThreadActionsOptions {
  thread: ThreadResponse;
  /** Called after the thread was deleted (leave the screen). */
  onDeleted: () => void;
  /** "Handoff to new thread": compose seeded with a mention of this thread. */
  onHandoffToNewThread: () => void;
  /** "New thread in this worktree"; null when the thread has no reusable worktree. */
  onNewThreadInWorktree: (() => void) | null;
  /** Opens the platform's rename UI (native prompt / sheet form). */
  onRename: () => void;
  /**
   * Opens a separate Move UI. When omitted the menu has no Move row and the
   * caller renders `sectionChoices` itself (the iOS submenu).
   */
  onMove?: () => void;
  /** Runs before every action's effect (the sheet dismisses itself). */
  onBeforeAction?: () => void;
}

const ARCHIVE_UNDO_TOAST_DURATION_MS = 8000;

export function useThreadActions({
  thread,
  onDeleted,
  onHandoffToNewThread,
  onNewThreadInWorktree,
  onRename,
  onMove,
  onBeforeAction,
}: UseThreadActionsOptions): ThreadActionsModel {
  const { serverUrl } = useProfileClient();
  const bootstrap = useSidebarBootstrap();
  const sections = bootstrap.data?.sections;

  const renameThread = useRenameThread();
  const moveThread = useMoveThreadToSection();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const archiveThread = useArchiveThread();
  const unarchiveThread = useUnarchiveThread();
  const deleteThread = useDeleteThread();
  const childSummary = useThreadChildSummary();
  const markRead = useMarkThreadRead();
  const markUnread = useMarkThreadUnread();

  const title = getThreadDisplayTitle(thread);
  const threadId = thread.id;
  const webUrl = buildThreadWebUrl({
    serverUrl,
    projectId: thread.projectId,
    threadId,
  });

  const unarchiveMany = useCallback(
    (threadIds: readonly string[]) => {
      for (const id of threadIds) unarchiveThread.mutate({ id });
    },
    [unarchiveThread],
  );

  const archiveWithUndo = useCallback(() => {
    archiveThread.mutate(
      { id: threadId },
      {
        onSuccess: (response) => {
          const count = response.archivedThreadIds.length;
          const toastId = `thread-archived-${threadId}`;
          toast.success(
            count > 1
              ? `Archived ${title} and ${count - 1} child ${count - 1 === 1 ? "thread" : "threads"}`
              : `Archived ${title}`,
            {
              id: toastId,
              duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
              action: {
                label: "Undo",
                onClick: () => {
                  toast.dismiss(toastId);
                  unarchiveMany(response.archivedThreadIds);
                },
              },
            },
          );
        },
      },
    );
  }, [archiveThread, threadId, title, unarchiveMany]);

  // Delete: the child-thread roll-up decides the confirmation copy, then the
  // system alert confirms (web ThreadActionsMenu's delete dialog).
  const requestDelete = useCallback(() => {
    childSummary.mutateAsync(threadId).then(
      (summary) => {
        const childThreadCount = summary.nonDeletedChildCount;
        const message = [
          childThreadCount > 0
            ? `${childThreadCount} child ${childThreadCount === 1 ? "thread" : "threads"} will be deleted.`
            : null,
          "This action cannot be undone.",
        ]
          .filter((part): part is string => part !== null)
          .join(" ");
        confirmDestructive({
          title: `Delete ${title}?`,
          message,
          actionLabel: "Delete",
          onConfirm: () => {
            deleteThread.mutate(
              { id: threadId, childThreadsConfirmed: childThreadCount > 0 },
              {
                onSuccess: () => {
                  toast.success("Thread deleted");
                  onDeleted();
                },
              },
            );
          },
        });
      },
      (error: unknown) => {
        toast.error("Could not check child threads", {
          description: describeError(error),
        });
      },
    );
  }, [childSummary, deleteThread, onDeleted, threadId, title]);

  const copyLink = useCallback(() => {
    void Clipboard.setStringAsync(webUrl)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Could not copy link"));
  }, [webUrl]);

  const shareLink = useCallback(() => {
    shareThreadLink({ title, url: webUrl }).catch(() => {
      toast.error("Could not open the share sheet");
    });
  }, [title, webUrl]);

  const openInWeb = useCallback(() => {
    Linking.openURL(webUrl).catch(() => {
      toast.error("Could not open the link");
    });
  }, [webUrl]);

  const rename = useCallback(
    (nextTitle: string) => {
      renameThread.mutate({ id: threadId, title: nextTitle });
    },
    [renameThread, threadId],
  );

  const isRead = isThreadRead(thread);
  const isPinned = thread.pinnedAt !== null;
  const isArchived = thread.archivedAt !== null;
  const sectionId = thread.sectionId;

  const actions = useMemo((): ThreadMenuAction[] => {
    const run = (effect: () => void) => () => {
      onBeforeAction?.();
      effect();
    };
    return [
      {
        key: "handoff",
        label: "Handoff to new thread",
        icon: "MessageSquarePlus",
        symbol: "square.and.pencil",
        onPress: run(onHandoffToNewThread),
      },
      ...(onNewThreadInWorktree
        ? [
            {
              key: "new-thread-in-worktree",
              label: "New thread in this worktree",
              icon: "FolderGit" as const,
              symbol: "folder.badge.plus" as const,
              onPress: run(onNewThreadInWorktree),
            },
          ]
        : []),
      {
        key: "rename",
        label: "Rename",
        icon: "Edit",
        // The rename UI takes over the sheet / presents its own alert; the
        // sheet must not dismiss first.
        onPress: onRename,
      },
      {
        key: isPinned ? "unpin" : "pin",
        label: isPinned ? "Unpin" : "Pin",
        icon: isPinned ? "PinOff" : "Pin",
        onPress: run(() => {
          if (isPinned) unpinThread.mutate({ id: threadId });
          else pinThread.mutate({ id: threadId });
        }),
      },
      {
        key: isRead ? "mark-unread" : "mark-read",
        label: isRead ? "Mark unread" : "Mark read",
        icon: isRead ? "Mail" : "MailOpen",
        symbol: isRead ? "envelope.badge" : "envelope.open",
        onPress: run(() => {
          if (isRead) markUnread.mutate(threadId);
          else markRead.mutate(threadId);
        }),
      },
      ...(onMove
        ? [
            {
              key: "move",
              label: "Move to section",
              icon: "Layers" as const,
              onPress: onMove,
            },
          ]
        : []),
      {
        key: "copy-link",
        label: "Copy link",
        icon: "Copy",
        symbol: "link",
        onPress: run(copyLink),
      },
      {
        key: "share-link",
        label: "Share link",
        icon: "ArrowUpRight",
        symbol: "square.and.arrow.up",
        onPress: run(shareLink),
      },
      {
        key: "open-in-web",
        label: "Open in web",
        icon: "ExternalLink",
        symbol: "safari",
        onPress: run(openInWeb),
      },
      {
        key: isArchived ? "unarchive" : "archive",
        label: isArchived ? "Unarchive" : "Archive",
        icon: isArchived ? "ArchiveRestore" : "Archive",
        onPress: run(() => {
          if (isArchived) unarchiveThread.mutate({ id: threadId });
          else archiveWithUndo();
        }),
      },
      {
        key: "delete",
        label: "Delete",
        icon: "Trash2",
        destructive: true,
        onPress: run(requestDelete),
      },
    ];
  }, [
    archiveWithUndo,
    copyLink,
    isArchived,
    isPinned,
    isRead,
    markRead,
    markUnread,
    onBeforeAction,
    onHandoffToNewThread,
    onMove,
    onNewThreadInWorktree,
    onRename,
    openInWeb,
    pinThread,
    requestDelete,
    shareLink,
    threadId,
    unarchiveThread,
    unpinThread,
  ]);

  const sectionChoices = useMemo((): ThreadSectionChoice[] => {
    const choose = (nextSectionId: string | null) => () => {
      onBeforeAction?.();
      if (sectionId !== nextSectionId) {
        moveThread.mutate({ id: threadId, sectionId: nextSectionId });
      }
    };
    return [
      ...(sections ?? []).map((section) => ({
        key: section.id,
        label: section.name,
        icon: "Layers" as const,
        selected: sectionId === section.id,
        onPress: choose(section.id),
        testID: `thread-move-${section.id}`,
      })),
      {
        key: "none",
        label: "Unorganized",
        icon: "Circle" as const,
        selected: sectionId === null,
        onPress: choose(null),
        testID: "thread-move-none",
      },
    ];
  }, [moveThread, onBeforeAction, sectionId, sections, threadId]);

  return {
    title,
    actions,
    sectionChoices,
    hasSections: (sections?.length ?? 0) > 0,
    rename,
    renamePending: renameThread.isPending,
  };
}
