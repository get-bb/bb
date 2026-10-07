import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { experimental_useThreadActions } from "@get-bb/plugin-sdk/app";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "../ui/action-menu-items.js";
import { CompactLongPressMenu } from "../ui/compact-long-press-menu.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { useCustomizeThreadRowActions } from "../list/customizeRowActionsContext.js";
import {
  groupThreadActionItems,
  ThreadActionDrawerStep,
  ThreadActionMenuRows,
  type ThreadActionMenuSurface,
} from "./ThreadActionMenuItems.js";
import { toThreadActionTarget, withInlineRename } from "./threadActionTarget.js";

const ACTIONS_STEP = "actions";

interface ThreadActionsMenuBaseProps {
  thread: SidebarThread;
  onRename: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

interface ThreadActionsMenuProps extends ThreadActionsMenuBaseProps {
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
}

interface ThreadActionsContextMenuProps extends ThreadActionsMenuBaseProps {
  children: ReactNode;
  disabled?: boolean;
  dragging?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ThreadActionsMenuItemsProps extends ThreadActionsMenuBaseProps {
  compactStep?: string;
  onCompactStepChange?: (step: string) => void;
  surface: ThreadActionMenuSurface;
}

function ThreadActionsMenuItems({
  thread,
  onRename,
  compactStep = ACTIONS_STEP,
  onCompactStepChange,
  surface,
}: ThreadActionsMenuItemsProps) {
  const customizeRowActions = useCustomizeThreadRowActions();
  const isCompactViewport = useIsCompactViewport();
  const target = useMemo(() => toThreadActionTarget(thread), [thread]);
  const items = withInlineRename(
    experimental_useThreadActions(target, "menu"),
    onRename,
  );
  const isDrawer = surface === "dropdown" && isCompactViewport;
  const showSeparators = !isDrawer;

  const stepItem =
    isDrawer && compactStep !== ACTIONS_STEP
      ? items.find((item) => item.key === compactStep)
      : undefined;
  if (stepItem?.action.choices !== undefined) {
    return (
      <ThreadActionDrawerStep
        item={stepItem}
        onBack={() => onCompactStepChange?.(ACTIONS_STEP)}
      />
    );
  }

  const separator = showSeparators ? (
    <ActionMenuSeparator surface={surface} />
  ) : null;
  const sections: { key: string; node: ReactNode }[] = groupThreadActionItems(
    items,
  ).map((group) => ({
    key: group[0]?.action.group ?? "",
    node: (
      <ThreadActionMenuRows
        items={group}
        surface={surface}
        isDrawer={isDrawer}
        onOpenDrawerStep={onCompactStepChange}
      />
    ),
  }));
  if (customizeRowActions) {
    const lifecycleIndex = sections.findIndex(
      (section) => section.key === "lifecycle",
    );
    sections.splice(
      lifecycleIndex === -1 ? sections.length : lifecycleIndex,
      0,
      {
        key: "customize",
        node: (
          <ActionMenuItem
            surface={surface}
            icon="FilterHorizontal"
            onSelect={() => customizeRowActions(thread.id)}
          >
            Customize row actions
          </ActionMenuItem>
        ),
      },
    );
  }

  return sections.map((section, index) => (
    <Fragment key={section.key}>
      {index > 0 ? separator : null}
      {section.node}
    </Fragment>
  ));
}

function useThreadActionsMenuLifecycle(onOpenChange?: (open: boolean) => void) {
  const [compactStep, setCompactStep] = useState(ACTIONS_STEP);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setCompactStep(ACTIONS_STEP);
      }
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  return { compactStep, setCompactStep, handleOpenChange };
}

export function ThreadActionsMenu({
  thread,
  onRename,
  onCloseAutoFocus,
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
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ThreadActionsMenuItems
          thread={thread}
          onRename={onRename}
          compactStep={compactStep}
          onCompactStepChange={setCompactStep}
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
          onRename={onRename}
          surface="context"
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
