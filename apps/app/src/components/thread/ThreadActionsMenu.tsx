import type { Thread } from "@bb/domain";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { Button } from "@/components/ui/button.js";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { cn } from "@/lib/utils";
import { isThreadRead } from "@/lib/thread-read-state";
import { useThreadActions } from "./ThreadActionsProvider";

interface ThreadActionsMenuBaseProps {
  thread: Thread;
  /**
   * Pass `false` to hide the Delete entry (e.g. sidebar rows that intentionally
   * route users to the thread detail page for destructive actions). Defaults
   * to true.
   */
  canDelete?: boolean;
}

interface ThreadActionsMenuProps extends ThreadActionsMenuBaseProps {
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
}

interface ThreadActionsContextMenuProps extends ThreadActionsMenuBaseProps {
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

type ThreadActionsMenuSurface = "context" | "dropdown";

interface ThreadActionsMenuItemsProps extends ThreadActionsMenuBaseProps {
  surface: ThreadActionsMenuSurface;
}

interface ThreadActionMenuItemProps {
  children: ReactNode;
  className?: string;
  icon: IconName;
  onSelect?: (event: Event) => void;
  surface: ThreadActionsMenuSurface;
}

function ThreadActionMenuItem({
  children,
  className,
  icon,
  onSelect,
  surface,
}: ThreadActionMenuItemProps) {
  const content = (
    <>
      <Icon name={icon} aria-hidden="true" />
      {children}
    </>
  );

  if (surface === "context") {
    return (
      <ContextMenuItem className={className} onSelect={onSelect}>
        {content}
      </ContextMenuItem>
    );
  }

  return (
    <DropdownMenuItem className={className} onSelect={onSelect}>
      {content}
    </DropdownMenuItem>
  );
}

function ThreadActionMenuSeparator({
  surface,
}: {
  surface: ThreadActionsMenuSurface;
}) {
  return surface === "context" ? (
    <ContextMenuSeparator />
  ) : (
    <DropdownMenuSeparator />
  );
}

function ThreadActionsMenuItems({
  thread,
  canDelete = true,
  surface,
}: ThreadActionsMenuItemsProps) {
  const {
    archiveThreadAndChildren,
    requestRename,
    requestDelete,
    togglePin,
    toggleRead,
    unarchiveThread,
    sendToPopout,
  } = useThreadActions();
  const isRead = isThreadRead(thread);
  const isArchived = thread.archivedAt != null;
  const isPinned = thread.pinnedAt !== null;

  return (
    <>
      <ThreadActionMenuItem
        surface={surface}
        icon={isRead ? "Mail" : "MailOpen"}
        onSelect={() => {
          toggleRead(thread);
        }}
      >
        {isRead ? "Mark as unread" : "Mark as read"}
      </ThreadActionMenuItem>
      <ThreadActionMenuItem
        surface={surface}
        icon={isPinned ? "PinOff" : "Pin"}
        onSelect={() => {
          togglePin(thread);
        }}
      >
        {isPinned ? "Unpin" : "Pin"}
      </ThreadActionMenuItem>
      <ThreadActionMenuSeparator surface={surface} />
      {sendToPopout !== null ? (
        <ThreadActionMenuItem
          surface={surface}
          icon="ExternalLink"
          onSelect={() => {
            sendToPopout(thread);
          }}
        >
          Send to popout
        </ThreadActionMenuItem>
      ) : null}
      <ThreadActionMenuItem
        surface={surface}
        icon="Edit"
        onSelect={() => {
          window.setTimeout(() => {
            requestRename(thread);
          }, 0);
        }}
      >
        Rename
      </ThreadActionMenuItem>
      <ThreadActionMenuSeparator surface={surface} />
      <ThreadActionMenuItem
        surface={surface}
        icon={isArchived ? "ArchiveRestore" : "Archive"}
        onSelect={() => {
          if (isArchived) {
            unarchiveThread(thread);
            return;
          }
          archiveThreadAndChildren(thread);
        }}
      >
        {isArchived ? "Unarchive" : "Archive"}
      </ThreadActionMenuItem>
      {canDelete ? (
        <ThreadActionMenuItem
          surface={surface}
          icon="Trash2"
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            window.setTimeout(() => {
              requestDelete(thread);
            }, 0);
          }}
        >
          Delete
        </ThreadActionMenuItem>
      ) : null}
    </>
  );
}

export function ThreadActionsMenu({
  thread,
  canDelete = true,
  onOpenChange,
  triggerClassName,
  align = "end",
}: ThreadActionsMenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0",
            triggerClassName,
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
          )}
          aria-label="Thread actions"
          title="Thread actions"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <ThreadActionsMenuItems
          thread={thread}
          canDelete={canDelete}
          surface="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadActionsContextMenu({
  children,
  thread,
  canDelete = true,
  onOpenChange,
}: ThreadActionsContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label="Thread actions">
        <ThreadActionsMenuItems
          thread={thread}
          canDelete={canDelete}
          surface="context"
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
