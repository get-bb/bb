import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import type {
  PluginThreadActionsContextMenuProps,
  PluginThreadActionsInlineItem,
  PluginThreadActionsMenuProps,
  PluginThreadActionsTriggerProps,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { CompactLongPressMenu } from "@bb/shared-ui/compact-long-press-menu";
import {
  ThreadActionMenuRows,
  useThreadActionMenuGroups,
  type ThreadActionMenuSurface,
} from "./ThreadActionMenuItems";

const MENU_LABEL = "Thread actions";

function ThreadActionsMenuItems({
  thread,
  inline,
  requestRename,
  surface,
  isDrawer,
  drawerStep,
  onDrawerStepChange,
}: {
  thread: PluginThreadActionTarget;
  inline?: readonly PluginThreadActionsInlineItem[];
  requestRename?: (threadId: string) => void;
  surface: ThreadActionMenuSurface;
  isDrawer: boolean;
  drawerStep: string | null;
  onDrawerStepChange: (key: string | null) => void;
}) {
  const groups = useThreadActionMenuGroups({ thread, inline, requestRename });
  return (
    <ThreadActionMenuRows
      groups={groups}
      surface={surface}
      isDrawer={isDrawer}
      drawerStep={drawerStep}
      onDrawerStepChange={onDrawerStepChange}
    />
  );
}

function describeTriggerContractViolation(
  element: HTMLElement | null,
  hostClassName: string | undefined,
): string | null {
  if (element === null) {
    return "did not attach the ref it received, so the menu cannot open; spread its props and ref onto the button";
  }
  const missing = (hostClassName ?? "")
    .split(/\s+/)
    .filter((name) => name.length > 0 && !element.classList.contains(name));
  return missing.length === 0
    ? null
    : `dropped the host's classes (${missing.join(" ")}); merge props.className into your own className`;
}

const ThreadActionsTriggerSlot = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & {
    render: (props: PluginThreadActionsTriggerProps) => ReactNode;
  }
>(function ThreadActionsTriggerSlot({ render, ...props }, ref) {
  const element = useRef<HTMLButtonElement | null>(null);
  const hostClassName = props.className;
  useLayoutEffect(() => {
    const problem = describeTriggerContractViolation(
      element.current,
      hostClassName,
    );
    if (problem !== null) {
      console.error(`experimental_ThreadActionsMenu: \`trigger\` ${problem}`);
    }
  }, [hostClassName]);
  return render({
    ...props,
    ref: (node: HTMLButtonElement | null) => {
      element.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref !== null) ref.current = node;
    },
  });
});

function useDrawerStep(onOpenChange?: (open: boolean) => void) {
  const [drawerStep, setDrawerStep] = useState<string | null>(null);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setDrawerStep(null);
      onOpenChange?.(open);
    },
    [onOpenChange],
  );
  return { drawerStep, setDrawerStep, handleOpenChange };
}

export function ThreadActionsMenu({
  thread,
  trigger,
  inline,
  requestRename,
  onOpenChange,
  onCloseAutoFocus,
  side,
  align = "end",
  sideOffset,
}: PluginThreadActionsMenuProps) {
  const isCompactViewport = useIsCompactViewport();
  const { drawerStep, setDrawerStep, handleOpenChange } =
    useDrawerStep(onOpenChange);
  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <ThreadActionsTriggerSlot render={trigger} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        mobileTitle={MENU_LABEL}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ThreadActionsMenuItems
          thread={thread}
          inline={inline}
          requestRename={requestRename}
          surface="dropdown"
          isDrawer={isCompactViewport}
          drawerStep={drawerStep}
          onDrawerStepChange={setDrawerStep}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadActionsContextMenu(
  props: PluginThreadActionsContextMenuProps,
) {
  const isCompactViewport = useIsCompactViewport();
  return isCompactViewport ? (
    <ThreadActionsLongPressMenu {...props} />
  ) : (
    <ThreadActionsDesktopContextMenu {...props} />
  );
}

function ThreadActionsLongPressMenu({
  thread,
  children,
  inline,
  requestRename,
  onOpenChange,
  disabled,
  dragging,
}: PluginThreadActionsContextMenuProps) {
  const { drawerStep, setDrawerStep, handleOpenChange } =
    useDrawerStep(onOpenChange);
  return (
    <CompactLongPressMenu
      label={MENU_LABEL}
      disabled={disabled}
      dragging={dragging}
      onOpenChange={handleOpenChange}
      items={
        <ThreadActionsMenuItems
          thread={thread}
          inline={inline}
          requestRename={requestRename}
          surface="dropdown"
          isDrawer
          drawerStep={drawerStep}
          onDrawerStepChange={setDrawerStep}
        />
      }
    >
      {children}
    </CompactLongPressMenu>
  );
}

function ThreadActionsDesktopContextMenu({
  thread,
  children,
  inline,
  requestRename,
  onOpenChange,
  onCloseAutoFocus,
  disabled,
  dragging = false,
}: PluginThreadActionsContextMenuProps) {
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
        aria-label={MENU_LABEL}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ThreadActionsMenuItems
          thread={thread}
          inline={inline}
          requestRename={requestRename}
          surface="context"
          isDrawer={false}
          drawerStep={null}
          onDrawerStepChange={() => {}}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
