import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
import {
  THREAD_ROW_ACTION_IDS,
  type ThreadRowActionId,
} from "../../shared/preferences.js";
import {
  useThreadSectionMove,
  type ThreadSectionMoveContextValue,
} from "./ThreadSectionMoveProvider.js";
import { THREAD_ROW_ACTIONS } from "./threadRowActions.js";
import { useCustomizeThreadRowActions } from "../list/customizeRowActionsContext.js";

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
type SidebarThreadActions = ReturnType<
  typeof experimental_useSidebarThreadActions
>;

interface ThreadRowActionHandlers {
  actions: SidebarThreadActions;
  unarchiveThread: (threadId: string) => Promise<boolean>;
}
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

export function canMoveThreadToSection(
  sectionMove: ThreadSectionMoveContextValue | null,
  thread: SidebarThread,
): sectionMove is ThreadSectionMoveContextValue {
  return (
    sectionMove !== null &&
    thread.parentThreadId === null &&
    thread.archivedAt === null &&
    sectionMove.destinations.some(
      (destination) =>
        thread.pinnedAt !== null || thread.sectionId !== destination.sectionId,
    )
  );
}

function ThreadSectionMoveItems({
  sectionMove,
  surface,
  thread,
}: {
  sectionMove: ThreadSectionMoveContextValue;
  surface: ThreadActionsMenuSurface;
  thread: SidebarThread;
}) {
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return sectionMove.destinations.map((destination) => {
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
  if (!canMoveThreadToSection(sectionMove, thread)) return null;

  const items = (
    <ThreadSectionMoveItems
      sectionMove={sectionMove}
      surface={surface}
      thread={thread}
    />
  );

  if (isDrawer) {
    if (!drawerStep) {
      return (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onOpenDrawerStep?.();
          }}
        >
          <Icon name={THREAD_ROW_ACTIONS.move.icon} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {THREAD_ROW_ACTIONS.move.label}
          </span>
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
        <DropdownMenuLabel>{THREAD_ROW_ACTIONS.move.label}</DropdownMenuLabel>
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
        <Icon name={THREAD_ROW_ACTIONS.move.icon} aria-hidden="true" />
        {THREAD_ROW_ACTIONS.move.label}
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
  const customizeRowActions = useCustomizeThreadRowActions();
  const actions = experimental_useSidebarThreadActions();
  const unarchiveThread = useUnarchiveThread();
  const isCompactViewport = useIsCompactViewport();
  const isDrawer = surface === "dropdown" && isCompactViewport;
  const showSeparators = !isDrawer;

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

  const separator = showSeparators ? (
    <ActionMenuSeparator surface={surface} />
  ) : null;
  const menuVariant: ThreadRowActionVariant = {
    kind: "menu",
    surface,
    isDrawer,
    onOpenDrawerStep: () => onCompactStepChange?.("move"),
  };

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
          {separator}
        </>
      ) : null}
      {THREAD_ROW_ACTION_IDS.map((id) => (
        <Fragment key={id}>
          {id === "archive" ? (
            <>
              {separator}
              {customizeRowActions ? (
                <>
                  <ActionMenuItem
                    surface={surface}
                    icon="FilterHorizontal"
                    onSelect={() => customizeRowActions(thread.id)}
                  >
                    Customize row actions
                  </ActionMenuItem>
                  {separator}
                </>
              ) : null}
            </>
          ) : null}
          <ThreadRowAction
            id={id}
            thread={thread}
            handlers={{ actions, unarchiveThread }}
            onOpenInSplit={onOpenInSplit}
            onRename={onRename}
            variant={menuVariant}
          />
          {id === "split" && onOpenInSplit ? separator : null}
        </Fragment>
      ))}
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

type ThreadRowActionVariant =
  | {
      kind: "menu";
      surface: ThreadActionsMenuSurface;
      isDrawer: boolean;
      onOpenDrawerStep: () => void;
    }
  | {
      kind: "button";
      className?: string;
      onMenuOpenChange?: (open: boolean) => void;
    };

interface ThreadRowActionModel {
  icon: IconName;
  label: string;
  run: () => void;
}

function threadRowActionModel(
  id: ThreadRowActionId,
  thread: SidebarThread,
  { actions, unarchiveThread }: ThreadRowActionHandlers,
  onOpenInSplit: (() => void) | undefined,
  onRename: () => void,
): ThreadRowActionModel | null {
  const isRead = !thread.isUnread;
  const isPinned = thread.pinnedAt !== null;
  const isArchived = thread.archivedAt != null;
  switch (id) {
    case "split":
      return onOpenInSplit
        ? { ...THREAD_ROW_ACTIONS.split, run: onOpenInSplit }
        : null;
    case "copyLink":
      return {
        ...THREAD_ROW_ACTIONS.copyLink,
        run: () => {
          void copyToClipboardWithToast(getThreadUrl(thread), {
            successMessage: "Thread link copied",
            errorMessage: "Failed to copy thread link",
          });
        },
      };
    case "read":
      return {
        icon: isRead ? "Mail" : "MailOpen",
        label: isRead ? "Mark unread" : "Mark read",
        run: () => {
          void actions.setRead(thread.id, !isRead);
        },
      };
    case "pin":
      return {
        icon: isPinned ? "PinOff" : "Pin",
        label: isPinned ? "Unpin" : "Pin",
        run: () => {
          void actions.setPinned(thread.id, !isPinned).catch(() => undefined);
        },
      };
    case "move":
      return null;
    case "rename":
      return { ...THREAD_ROW_ACTIONS.rename, run: onRename };
    case "archive":
      return {
        icon: isArchived ? "ArchiveRestore" : "Archive",
        label: isArchived ? "Unarchive" : "Archive",
        run: () => {
          if (isArchived) {
            void unarchiveThread(thread.id);
            return;
          }
          actions.archive(thread.id);
        },
      };
  }
}

export function ThreadRowAction({
  id,
  thread,
  handlers,
  onOpenInSplit,
  onRename,
  variant,
}: {
  id: ThreadRowActionId;
  thread: SidebarThread;
  handlers: ThreadRowActionHandlers;
  onOpenInSplit?: () => void;
  onRename: () => void;
  variant: ThreadRowActionVariant;
}) {
  if (id === "move") {
    return variant.kind === "menu" ? (
      <ThreadSectionMoveMenu
        isDrawer={variant.isDrawer}
        onOpenDrawerStep={variant.onOpenDrawerStep}
        surface={variant.surface}
        thread={thread}
      />
    ) : (
      <ThreadMoveQuickAction
        thread={thread}
        className={variant.className}
        onOpenChange={variant.onMenuOpenChange}
      />
    );
  }
  if (variant.kind === "button" && id === "archive") {
    return (
      <ThreadArchiveQuickAction thread={thread} className={variant.className} />
    );
  }
  const model = threadRowActionModel(
    id,
    thread,
    handlers,
    onOpenInSplit,
    onRename,
  );
  if (!model) return null;
  if (variant.kind === "menu") {
    return (
      <ActionMenuItem
        surface={variant.surface}
        icon={model.icon}
        onSelect={model.run}
      >
        {model.label}
      </ActionMenuItem>
    );
  }
  return (
    <ThreadQuickActionButton
      icon={model.icon}
      label={model.label}
      className={variant.className}
      onSelect={model.run}
    />
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

function ThreadQuickActionButton({
  icon,
  label,
  className,
  onSelect,
}: {
  icon: IconName;
  label: string;
  className?: string;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("rounded-md p-0", className)}
          aria-label={label}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect();
          }}
        >
          <Icon name={icon} className={COARSE_POINTER_ICON_SIZE_CLASS} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function visibleThreadRowActions(
  actionIds: readonly ThreadRowActionId[],
  available: { split: boolean; move: boolean },
): ThreadRowActionId[] {
  return actionIds.filter(
    (id) =>
      (id !== "split" || available.split) && (id !== "move" || available.move),
  );
}

function ThreadMoveQuickAction({
  thread,
  className,
  onOpenChange,
}: {
  thread: SidebarThread;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const sectionMove = useThreadSectionMove();
  if (!canMoveThreadToSection(sectionMove, thread)) return null;
  const { icon, label } = THREAD_ROW_ACTIONS.move;
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "rounded-md p-0",
                "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
                className,
              )}
              aria-label={label}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <Icon name={icon} className={COARSE_POINTER_ICON_SIZE_CLASS} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto"
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <ThreadSectionMoveItems
          sectionMove={sectionMove}
          surface="dropdown"
          thread={thread}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadRowQuickActions({
  actionIds,
  actions,
  thread,
  className,
  onOpenInSplit,
  onRename,
  onMenuOpenChange,
}: {
  actionIds: readonly ThreadRowActionId[];
  actions: SidebarThreadActions;
  thread: SidebarThread;
  className?: string;
  onOpenInSplit: () => void;
  onRename: () => void;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const unarchiveThread = useUnarchiveThread();
  return actionIds.map((id) => (
    <ThreadRowAction
      key={id}
      id={id}
      thread={thread}
      handlers={{ actions, unarchiveThread }}
      onOpenInSplit={onOpenInSplit}
      onRename={onRename}
      variant={{ kind: "button", className, onMenuOpenChange }}
    />
  ));
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
          data-thread-actions-trigger=""
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
