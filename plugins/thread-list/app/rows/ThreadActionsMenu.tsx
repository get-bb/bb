import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import {
  experimental_useSidebarThreadActions,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { ActionMenuItem, ActionMenuSeparator } from "../ui/action-menu-items.js";
import { CompactLongPressMenu } from "../ui/compact-long-press-menu.js";
import { copyToClipboardWithToast } from "../ui/clipboard.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { useThreadSectionMove } from "./ThreadSectionMoveProvider.js";

interface ThreadActionsMenuBaseProps {
  thread: SidebarThread;
  onOpenInSplit?: () => void;
  onRename: () => void;
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

interface ThreadActionsContextMenuProps extends ThreadActionsMenuBaseProps {
  children: ReactNode;
  disabled?: boolean;
  dragging?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ThreadActionsMenuSurface = "context" | "dropdown";
type ThreadActionsCompactStep = "actions" | "move";

interface ThreadActionsMenuItemsProps extends ThreadActionsMenuBaseProps {
  compactStep?: ThreadActionsCompactStep;
  onCompactStepChange?: (step: ThreadActionsCompactStep) => void;
  responsiveActions?: readonly ThreadActionsMenuResponsiveAction[];
  surface: ThreadActionsMenuSurface;
}

export function useUnarchiveThread(): (threadId: string) => Promise<boolean> {
  const sdk = useSdk();
  return useCallback(
    async (threadId: string) => {
      try {
        await sdk.threads.unarchive({ threadId });
        return true;
      } catch {
        toast.error("Failed to unarchive thread.");
        return false;
      }
    },
    [sdk],
  );
}

export function getThreadUrl(thread: SidebarThread): string {
  return new URL(thread.href, window.location.origin).toString();
}

function ThreadSectionMoveMenu({
  drawerStep = false,
  isDrawer,
  onBack,
  onOpenDrawerStep,
  surface,
  thread,
}: {
  drawerStep?: boolean;
  isDrawer: boolean;
  onBack?: () => void;
  onOpenDrawerStep?: () => void;
  surface: ThreadActionsMenuSurface;
  thread: SidebarThread;
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

  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  const items = sectionMove.destinations.map((destination) => {
    const isCurrent =
      thread.pinnedAt === null && thread.sectionId === destination.sectionId;
    return (
      <Item
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
      </Item>
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

  const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger =
    surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent =
    surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;

  return (
    <Sub>
      <SubTrigger>
        <Icon name="SectionMove" aria-hidden="true" />
        Move to section
      </SubTrigger>
      <SubContent className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto">
        {items}
      </SubContent>
    </Sub>
  );
}

function ThreadActionsMenuItems({
  thread,
  onOpenInSplit,
  onRename,
  compactStep = "actions",
  onCompactStepChange,
  responsiveActions = [],
  surface,
}: ThreadActionsMenuItemsProps) {
  const actions = experimental_useSidebarThreadActions();
  const unarchiveThread = useUnarchiveThread();
  const isCompactViewport = useIsCompactViewport();
  const isDrawer = surface === "dropdown" && isCompactViewport;
  const showSeparators = !isDrawer;
  const isRead = !thread.isUnread;
  const isArchived = thread.archivedAt != null;
  const isPinned = thread.pinnedAt !== null;
  const threadUrl = getThreadUrl(thread);

  if (isDrawer && compactStep === "move") {
    return (
      <ThreadSectionMoveMenu
        drawerStep
        isDrawer
        onBack={() => onCompactStepChange?.("actions")}
        surface={surface}
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
              surface={surface}
              icon={action.icon}
              onSelect={() => {
                void action.onSelect();
              }}
            >
              {action.label}
            </ActionMenuItem>
          ))}
          {showSeparators ? <ActionMenuSeparator surface={surface} /> : null}
        </>
      ) : null}
      {onOpenInSplit ? (
        <>
          <ActionMenuItem
            surface={surface}
            icon="Columns2"
            onSelect={() => {
              onOpenInSplit();
            }}
          >
            Open in split
          </ActionMenuItem>
          {showSeparators ? <ActionMenuSeparator surface={surface} /> : null}
        </>
      ) : null}
      <ActionMenuItem
        surface={surface}
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
        surface={surface}
        icon={isRead ? "Mail" : "MailOpen"}
        onSelect={() => {
          void actions.setRead(thread.id, !isRead);
        }}
      >
        {isRead ? "Mark unread" : "Mark read"}
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon={isPinned ? "PinOff" : "Pin"}
        onSelect={() => {
          void actions.setPinned(thread.id, !isPinned).catch(() => undefined);
        }}
      >
        {isPinned ? "Unpin" : "Pin"}
      </ActionMenuItem>
      <ThreadSectionMoveMenu
        isDrawer={isDrawer}
        onOpenDrawerStep={() => onCompactStepChange?.("move")}
        surface={surface}
        thread={thread}
      />
      <ActionMenuItem
        surface={surface}
        icon="Edit"
        onSelect={() => {
          onRename();
        }}
      >
        Rename
      </ActionMenuItem>
      {showSeparators ? <ActionMenuSeparator surface={surface} /> : null}
      <ActionMenuItem
        surface={surface}
        icon={isArchived ? "ArchiveRestore" : "Archive"}
        onSelect={() => {
          if (isArchived) {
            void unarchiveThread(thread.id);
            return;
          }
          actions.archive(thread.id);
        }}
      >
        {isArchived ? "Unarchive" : "Archive"}
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon="Trash2"
        variant="destructive"
        onSelect={() => {
          window.setTimeout(() => {
            actions.requestDelete(thread.id);
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

export function ThreadArchiveQuickAction({
  thread,
  className,
  disabled,
}: {
  thread: SidebarThread;
  className?: string;
  disabled?: boolean;
}) {
  const actions = experimental_useSidebarThreadActions();
  const unarchiveThread = useUnarchiveThread();
  const [isRestoring, setIsRestoring] = useState(false);
  const isArchived = thread.archivedAt != null;
  const label = isArchived ? "Unarchive" : "Archive";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("rounded-md p-0", className)}
          aria-label={`${label} thread`}
          disabled={disabled || isRestoring}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isArchived) {
              setIsRestoring(true);
              void unarchiveThread(thread.id).finally(() => {
                setIsRestoring(false);
              });
              return;
            }
            actions.archive(thread.id);
          }}
        >
          <Icon
            name={isArchived ? "ArchiveRestore" : "Archive"}
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
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
          surface="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadActionsContextMenu(props: ThreadActionsContextMenuProps) {
  const isCompactViewport = useIsCompactViewport();
  if (isCompactViewport) {
    return <ThreadActionsCompactLongPressMenu {...props} />;
  }
  return <ThreadActionsDesktopContextMenu {...props} />;
}

function ThreadActionsCompactLongPressMenu({
  children,
  disabled,
  dragging,
  thread,
  onOpenInSplit,
  onOpenChange,
  onRename,
}: ThreadActionsContextMenuProps) {
  const { compactStep, setCompactStep, handleOpenChange } =
    useThreadActionsMenuLifecycle(onOpenChange);

  return (
    <CompactLongPressMenu
      label="Thread actions"
      disabled={disabled}
      dragging={dragging}
      onOpenChange={handleOpenChange}
      items={
        <ThreadActionsMenuItems
          thread={thread}
          onOpenInSplit={onOpenInSplit}
          onRename={onRename}
          compactStep={compactStep}
          onCompactStepChange={setCompactStep}
          surface="dropdown"
        />
      }
    >
      {children}
    </CompactLongPressMenu>
  );
}

function ThreadActionsDesktopContextMenu({
  children,
  disabled,
  dragging,
  thread,
  onOpenInSplit,
  onOpenChange,
  onRename,
  onCloseAutoFocus,
}: ThreadActionsContextMenuProps) {
  const [open, setOpen] = useState(false);
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && dragging) return;
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [dragging, onOpenChange],
  );
  useEffect(() => {
    if (dragging && open) handleOpenChange(false);
  }, [dragging, handleOpenChange, open]);

  return (
    <ContextMenu open={open} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild disabled={disabled || dragging}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label="Thread actions"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ThreadActionsMenuItems
          thread={thread}
          onOpenInSplit={onOpenInSplit}
          onRename={onRename}
          surface="context"
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
