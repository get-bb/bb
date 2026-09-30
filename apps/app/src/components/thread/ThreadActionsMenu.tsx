import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import type { Thread } from "@bb/domain";
import { useCallback, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { isThreadRead } from "@bb/client-core";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useThreadActions } from "./ThreadActionsProvider";
import { useThreadSectionMove } from "./ThreadSectionMoveProvider";

interface ThreadActionsMenuBaseProps {
  thread: Thread;
  onOpenInSplit?: () => void;
  onRename?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export interface ThreadActionsMenuResponsiveAction {
  icon: IconName;
  label: string;
  onSelect: () => void | Promise<void>;
}

interface ThreadActionsMenuProps extends ThreadActionsMenuBaseProps {
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  responsiveActions?: readonly ThreadActionsMenuResponsiveAction[];
}

type ThreadActionsCompactStep = "actions" | "move";

interface ThreadActionsMenuItemsProps extends ThreadActionsMenuBaseProps {
  compactStep?: ThreadActionsCompactStep;
  onCompactStepChange?: (step: ThreadActionsCompactStep) => void;
  responsiveActions?: readonly ThreadActionsMenuResponsiveAction[];
}

function ThreadSectionMoveMenu({
  drawerStep = false,
  isDrawer,
  onBack,
  onOpenDrawerStep,
  thread,
}: {
  drawerStep?: boolean;
  isDrawer: boolean;
  onBack?: () => void;
  onOpenDrawerStep?: () => void;
  thread: Thread;
}) {
  const sectionMove = useThreadSectionMove();
  if (
    !sectionMove ||
    thread.parentThreadId !== null ||
    thread.archivedAt !== null
  ) {
    return null;
  }

  const hasValidDestination = sectionMove.destinations.some(
    (destination) =>
      thread.pinnedAt !== null || thread.sectionId !== destination.sectionId,
  );
  if (!hasValidDestination) return null;

  const items = sectionMove.destinations.map((destination) => {
    const isCurrent =
      thread.pinnedAt === null && thread.sectionId === destination.sectionId;
    return (
      <DropdownMenuItem
        key={destination.sectionId ?? "threads"}
        aria-current={isCurrent ? "true" : undefined}
        className="flex items-center justify-between gap-3"
        disabled={isCurrent}
        onSelect={() => sectionMove.moveThread(thread, destination.sectionId)}
      >
        <span className="min-w-0 flex-1 truncate">{destination.label}</span>
        {isCurrent ? (
          <Icon name="Check" className="ml-auto" aria-hidden="true" />
        ) : null}
      </DropdownMenuItem>
    );
  });

  if (isDrawer) {
    if (!drawerStep) {
      return (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onOpenDrawerStep?.();
          }}
        >
          <Icon name="SectionMove" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Move to section</span>
          <Icon name="ChevronRight" className="ml-auto" aria-hidden="true" />
        </DropdownMenuItem>
      );
    }
    return (
      <>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onBack?.();
          }}
        >
          <Icon name="ChevronLeft" aria-hidden="true" />
          Back
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Move to section</DropdownMenuLabel>
        {items}
      </>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name="SectionMove" aria-hidden="true" />
        Move to section
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto">
        {items}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ThreadActionsMenuItems({
  thread,
  onOpenInSplit,
  onRename,
  compactStep = "actions",
  onCompactStepChange,
  responsiveActions = [],
}: ThreadActionsMenuItemsProps) {
  const {
    requestArchive,
    requestRename,
    requestDelete,
    togglePin,
    toggleRead,
    unarchiveThread,
  } = useThreadActions();
  const isCompactViewport = useIsCompactViewport();
  const isDrawer = isCompactViewport;
  const showSeparators = !isDrawer;
  const isRead = isThreadRead(thread);
  const isArchived = thread.archivedAt != null;
  const isPinned = thread.pinnedAt !== null;
  const threadUrl = new URL(
    getThreadRoutePath({ projectId: thread.projectId, threadId: thread.id }),
    window.location.origin,
  ).toString();

  if (isDrawer && compactStep === "move") {
    return (
      <ThreadSectionMoveMenu
        drawerStep
        isDrawer
        onBack={() => onCompactStepChange?.("actions")}
        thread={thread}
      />
    );
  }

  return (
    <>
      {responsiveActions.length > 0 ? (
        <>
          {responsiveActions.map((action) => (
            <ActionMenuItem
              key={action.label}
              surface="dropdown"
              icon={action.icon}
              onSelect={() => {
                void action.onSelect();
              }}
            >
              {action.label}
            </ActionMenuItem>
          ))}
          {showSeparators ? <ActionMenuSeparator surface="dropdown" /> : null}
        </>
      ) : null}
      {onOpenInSplit ? (
        <>
          <ActionMenuItem
            surface="dropdown"
            icon="Columns2"
            onSelect={() => {
              onOpenInSplit();
            }}
          >
            Open in split
          </ActionMenuItem>
          {showSeparators ? <ActionMenuSeparator surface="dropdown" /> : null}
        </>
      ) : null}
      <ActionMenuItem
        surface="dropdown"
        icon="Copy"
        onSelect={() => {
          void copyToClipboardWithToast(threadUrl, {
            successMessage: "Thread link copied",
            errorMessage: "Failed to copy thread link",
          });
        }}
      >
        Copy thread link
      </ActionMenuItem>
      <ActionMenuItem
        surface="dropdown"
        icon={isRead ? "Mail" : "MailOpen"}
        onSelect={() => {
          toggleRead(thread);
        }}
      >
        {isRead ? "Mark unread" : "Mark read"}
      </ActionMenuItem>
      <ActionMenuItem
        surface="dropdown"
        icon={isPinned ? "PinOff" : "Pin"}
        onSelect={() => {
          togglePin(thread);
        }}
      >
        {isPinned ? "Unpin" : "Pin"}
      </ActionMenuItem>
      <ThreadSectionMoveMenu
        isDrawer={isDrawer}
        onOpenDrawerStep={() => onCompactStepChange?.("move")}
        thread={thread}
      />
      <ActionMenuItem
        surface="dropdown"
        icon="Edit"
        onSelect={() => {
          if (onRename) {
            onRename();
            return;
          }
          window.setTimeout(() => {
            requestRename(thread);
          }, 0);
        }}
      >
        Rename
      </ActionMenuItem>
      {showSeparators ? <ActionMenuSeparator surface="dropdown" /> : null}
      <ActionMenuItem
        surface="dropdown"
        icon={isArchived ? "ArchiveRestore" : "Archive"}
        onSelect={() => {
          if (isArchived) {
            unarchiveThread(thread);
            return;
          }
          window.setTimeout(() => {
            requestArchive(thread);
          }, 0);
        }}
      >
        {isArchived ? "Unarchive" : "Archive"}
      </ActionMenuItem>
      <ActionMenuItem
        surface="dropdown"
        icon="Trash2"
        variant="destructive"
        onSelect={() => {
          window.setTimeout(() => {
            requestDelete(thread);
          }, 0);
        }}
      >
        Delete
      </ActionMenuItem>
    </>
  );
}

function useThreadActionsMenuLifecycle(onOpenChange?: (open: boolean) => void) {
  const [compactStep, setCompactStep] =
    useState<ThreadActionsCompactStep>("actions");
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setCompactStep("actions");
      }
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  return { compactStep, setCompactStep, handleOpenChange };
}

export function ThreadActionsMenu({
  thread,
  onOpenInSplit,
  onRename,
  onCloseAutoFocus,
  responsiveActions,
  onOpenChange,
  triggerClassName,
}: ThreadActionsMenuProps) {
  const { compactStep, setCompactStep, handleOpenChange } =
    useThreadActionsMenuLifecycle(onOpenChange);

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0",
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
            triggerClassName,
          )}
          aria-label="Thread actions"
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
      <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
        <ThreadActionsMenuItems
          thread={thread}
          onOpenInSplit={onOpenInSplit}
          onRename={onRename}
          compactStep={compactStep}
          onCompactStepChange={setCompactStep}
          responsiveActions={responsiveActions}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
