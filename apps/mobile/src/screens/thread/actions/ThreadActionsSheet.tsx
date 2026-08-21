import { isThreadRead } from "@bb/client-core";
import type { ThreadResponse } from "@bb/server-contract";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Separator,
  Sheet,
  Spinner,
  Text,
  toast,
  useSheet,
  type IconName,
  type SheetController,
} from "@/ui";
import { CenteredRow, CheckRow, SheetHeader } from "../../shell/sheet-rows";
import { SheetNameForm } from "../../sidebar/SheetNameForm";
import { buildThreadWebUrl } from "./thread-links";

/**
 * The thread header's "…" menu and its follow-up forms (rename, move to
 * section, delete confirmation) as one bottom sheet whose content follows
 * a small state machine — the same shape as the sidebar's long-press menu
 * (web ThreadActionsMenu), plus Copy link / Open in web.
 */

type SheetState =
  | { view: "menu" }
  | { view: "rename" }
  | { view: "move" }
  | {
      view: "delete";
      /** Null while the child summary loads. */
      childThreadCount: number | null;
    };

interface ThreadActionsSheetController {
  sheet: SheetController;
  state: SheetState | null;
  setState: (state: SheetState | null) => void;
  /** Open the sheet on the menu or straight on the rename form. */
  present: (view: "menu" | "rename") => void;
  dismiss: () => void;
}

export function useThreadActionsSheet(): ThreadActionsSheetController {
  const sheet = useSheet();
  const [state, setState] = useState<SheetState | null>(null);
  const present = useCallback(
    (view: "menu" | "rename") => {
      setState({ view });
      sheet.present();
    },
    [sheet],
  );
  const dismiss = useCallback(() => sheet.dismiss(), [sheet]);
  return useMemo(
    () => ({ sheet, state, setState, present, dismiss }),
    [dismiss, present, sheet, state],
  );
}

export interface ThreadMenuAction {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  disabled?: boolean;
  /** Replaces the icon with a spinner (action in flight). */
  pending?: boolean;
  onPress: () => void;
  testID?: string;
}

type MenuAction = ThreadMenuAction;

function MenuRows({ actions }: { actions: readonly MenuAction[] }) {
  const { tokens } = useTheme();
  return (
    <>
      {actions.map((action) => (
        <ListRow
          key={action.key}
          title={action.label}
          leading={
            action.pending ? (
              <Spinner size="small" color={tokens.mutedForeground} />
            ) : (
              <Icon
                name={action.icon}
                size={20}
                color={
                  action.destructive
                    ? tokens.destructiveText
                    : tokens.foreground
                }
              />
            )
          }
          destructive={action.destructive}
          disabled={action.disabled || action.pending}
          onPress={action.onPress}
          testID={action.testID ?? `thread-action-${action.key}`}
        />
      ))}
    </>
  );
}

const ARCHIVE_UNDO_TOAST_DURATION_MS = 8000;

interface ThreadActionsSheetProps {
  controller: ThreadActionsSheetController;
  thread: ThreadResponse;
  /** Called after the thread was deleted (leave the screen). */
  onDeleted: () => void;
  /** "Handoff to new thread": compose seeded with a mention of this thread. */
  onHandoffToNewThread: () => void;
  /** "New thread in this worktree"; null when the thread has no reusable worktree. */
  onNewThreadInWorktree: (() => void) | null;
  /**
   * Screen-owned rows listed first (workspace panel, the
   * git action): the thread screen has no second header, so these live here.
   */
  leadingActions?: readonly ThreadMenuAction[];
  /** One-line detail under the title ("project · host · worktree · branch"). */
  headerDetail?: string | null;
}

const EMPTY_LEADING_ACTIONS: readonly ThreadMenuAction[] = [];

export function ThreadActionsSheet({
  controller,
  thread,
  onDeleted,
  onHandoffToNewThread,
  onNewThreadInWorktree,
  leadingActions = EMPTY_LEADING_ACTIONS,
  headerDetail = null,
}: ThreadActionsSheetProps) {
  const { tokens } = useTheme();
  const { serverUrl } = useProfileClient();
  const { sheet, state, setState, dismiss } = controller;
  const bootstrap = useSidebarBootstrap();
  const sections = bootstrap.data?.sections ?? [];

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
  const webUrl = buildThreadWebUrl({
    serverUrl,
    projectId: thread.projectId,
    threadId: thread.id,
  });

  const unarchiveMany = useCallback(
    (threadIds: readonly string[]) => {
      for (const id of threadIds) unarchiveThread.mutate({ id });
    },
    [unarchiveThread],
  );

  const archiveWithUndo = useCallback(() => {
    archiveThread.mutate(
      { id: thread.id },
      {
        onSuccess: (response) => {
          const count = response.archivedThreadIds.length;
          const toastId = `thread-archived-${thread.id}`;
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
  }, [archiveThread, thread.id, title, unarchiveMany]);

  const requestDelete = useCallback(() => {
    setState({ view: "delete", childThreadCount: null });
    childSummary.mutateAsync(thread.id).then(
      (summary) => {
        setState({
          view: "delete",
          childThreadCount: summary.nonDeletedChildCount,
        });
      },
      (error: unknown) => {
        toast.error("Could not check child threads", {
          description: describeError(error),
        });
        dismiss();
      },
    );
  }, [childSummary, dismiss, setState, thread.id]);

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

  const renderContent = (): ReactNode => {
    if (!state) return null;
    switch (state.view) {
      case "menu": {
        const isRead = isThreadRead(thread);
        const isPinned = thread.pinnedAt !== null;
        const isArchived = thread.archivedAt !== null;
        const menu: MenuAction[] = [
          {
            key: "handoff",
            label: "Handoff to new thread",
            icon: "MessageSquarePlus",
            onPress: () => {
              dismiss();
              onHandoffToNewThread();
            },
          },
          ...(onNewThreadInWorktree
            ? [
                {
                  key: "new-thread-in-worktree",
                  label: "New thread in this worktree",
                  icon: "FolderGit" as const,
                  onPress: () => {
                    dismiss();
                    onNewThreadInWorktree();
                  },
                },
              ]
            : []),
          {
            key: "rename",
            label: "Rename",
            icon: "Edit",
            onPress: () => setState({ view: "rename" }),
          },
          {
            key: isPinned ? "unpin" : "pin",
            label: isPinned ? "Unpin" : "Pin",
            icon: isPinned ? "PinOff" : "Pin",
            onPress: () => {
              dismiss();
              if (isPinned) unpinThread.mutate({ id: thread.id });
              else pinThread.mutate({ id: thread.id });
            },
          },
          {
            key: isRead ? "mark-unread" : "mark-read",
            label: isRead ? "Mark unread" : "Mark read",
            icon: isRead ? "Mail" : "MailOpen",
            onPress: () => {
              dismiss();
              if (isRead) markUnread.mutate(thread.id);
              else markRead.mutate(thread.id);
            },
          },
          {
            key: "move",
            label: "Move to section",
            icon: "Layers",
            onPress: () => setState({ view: "move" }),
          },
          {
            key: "copy-link",
            label: "Copy link",
            icon: "Copy",
            onPress: () => {
              dismiss();
              copyLink();
            },
          },
          {
            key: "share-link",
            label: "Share link",
            icon: "ArrowUpRight",
            onPress: () => {
              dismiss();
              shareLink();
            },
          },
          {
            key: "open-in-web",
            label: "Open in web",
            icon: "ExternalLink",
            onPress: () => {
              dismiss();
              openInWeb();
            },
          },
          {
            key: isArchived ? "unarchive" : "archive",
            label: isArchived ? "Unarchive" : "Archive",
            icon: isArchived ? "ArchiveRestore" : "Archive",
            onPress: () => {
              dismiss();
              if (isArchived) unarchiveThread.mutate({ id: thread.id });
              else archiveWithUndo();
            },
          },
          {
            key: "delete",
            label: "Delete",
            icon: "Trash2",
            destructive: true,
            onPress: requestDelete,
          },
        ];
        return (
          <>
            <SheetHeader title={title} message={headerDetail} />
            {leadingActions.length > 0 ? (
              <>
                <MenuRows actions={leadingActions} />
                <Separator />
              </>
            ) : null}
            <MenuRows actions={menu} />
          </>
        );
      }
      case "rename":
        return (
          <SheetNameForm
            title="Rename thread"
            initialValue={title}
            submitLabel="Rename"
            pending={renameThread.isPending}
            autoCapitalize="sentences"
            onSubmit={(nextTitle) => {
              renameThread.mutate(
                { id: thread.id, title: nextTitle },
                { onSettled: dismiss },
              );
            }}
            onCancel={dismiss}
            testID="thread-rename"
          />
        );
      case "move":
        return (
          <>
            <SheetHeader title="Move to section" message={title} />
            {sections.map((section) => (
              <CheckRow
                key={section.id}
                label={section.name}
                icon="Layers"
                checked={thread.sectionId === section.id}
                onPress={() => {
                  dismiss();
                  if (thread.sectionId !== section.id) {
                    moveThread.mutate({ id: thread.id, sectionId: section.id });
                  }
                }}
                testID={`thread-move-${section.id}`}
              />
            ))}
            <CheckRow
              label="Unorganized"
              icon="Circle"
              checked={thread.sectionId === null}
              onPress={() => {
                dismiss();
                if (thread.sectionId !== null) {
                  moveThread.mutate({ id: thread.id, sectionId: null });
                }
              }}
              testID="thread-move-none"
            />
            {sections.length === 0 ? (
              <Text variant="caption" className="px-4 pb-2 pt-1">
                Create sections from the sidebar display options.
              </Text>
            ) : null}
          </>
        );
      case "delete": {
        const { childThreadCount } = state;
        const message =
          childThreadCount === null
            ? "Checking child threads…"
            : [
                childThreadCount > 0
                  ? `${childThreadCount} child ${childThreadCount === 1 ? "thread" : "threads"} will be deleted.`
                  : null,
                "This action cannot be undone.",
              ]
                .filter((part): part is string => part !== null)
                .join(" ");
        const pending = childThreadCount === null || deleteThread.isPending;
        return (
          <>
            <SheetHeader title={`Delete ${title}?`} message={message} />
            <ListRow
              title={pending ? "Delete thread…" : "Delete thread"}
              leading={
                <Icon name="Trash2" size={20} color={tokens.destructiveText} />
              }
              destructive
              disabled={pending}
              onPress={() => {
                if (childThreadCount === null) return;
                deleteThread.mutate(
                  {
                    id: thread.id,
                    childThreadsConfirmed: childThreadCount > 0,
                  },
                  {
                    onSuccess: () => {
                      toast.success("Thread deleted");
                      onDeleted();
                    },
                    onSettled: dismiss,
                  },
                );
              }}
              testID="thread-delete-confirm"
            />
            <Separator />
            <CenteredRow
              label="Cancel"
              onPress={dismiss}
              testID="thread-delete-cancel"
            />
          </>
        );
      }
    }
  };

  return (
    <Sheet
      controller={sheet}
      layout="scroll"
      deferContent={false}
      onDismiss={() => setState(null)}
    >
      {renderContent()}
    </Sheet>
  );
}

export type { SheetState as ThreadActionsSheetState };
