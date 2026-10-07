import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Thread } from "@bb/domain";
import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { toThreadActionTarget } from "@/lib/thread-actions/thread-action-target";
import { useThreadActionItems } from "@/lib/thread-actions/use-thread-action-items";
import {
  groupThreadActionItems,
  ThreadActionDrawerStep,
  ThreadActionMenuRows,
} from "./ThreadActionMenuItems";

const SPLIT_ACTION_KEY = "core:split";
const ACTIONS_STEP = "actions";

interface ThreadActionsMenuBaseProps {
  thread: Thread;
  environment?: PluginThreadActionTarget["environment"];
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

interface ThreadActionsMenuItemsProps extends ThreadActionsMenuBaseProps {
  compactStep?: string;
  onCompactStepChange?: (step: string) => void;
  responsiveActions?: readonly ThreadActionsMenuResponsiveAction[];
}

function ThreadActionsMenuItems({
  thread,
  environment = null,
  compactStep = ACTIONS_STEP,
  onCompactStepChange,
  responsiveActions = [],
}: ThreadActionsMenuItemsProps) {
  const isDrawer = useIsCompactViewport();
  const target = useMemo(
    () => toThreadActionTarget(thread, environment),
    [environment, thread],
  );
  const items = useThreadActionItems(target, "menu").filter(
    (item) => item.key !== SPLIT_ACTION_KEY,
  );
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
    <ActionMenuSeparator surface="dropdown" />
  ) : null;

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
          {separator}
        </>
      ) : null}
      {groupThreadActionItems(items).map((group, index) => (
        <Fragment key={group[0]?.action.group}>
          {index > 0 ? separator : null}
          <ThreadActionMenuRows
            items={group}
            surface="dropdown"
            isDrawer={isDrawer}
            onOpenDrawerStep={onCompactStepChange}
          />
        </Fragment>
      ))}
    </>
  );
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
  environment,
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
      <DropdownMenuContent align="end">
        <ThreadActionsMenuItems
          thread={thread}
          environment={environment}
          compactStep={compactStep}
          onCompactStepChange={setCompactStep}
          responsiveActions={responsiveActions}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadActionsLongPressMenu({
  children,
  thread,
}: {
  children: ReactNode;
  thread: Thread;
}) {
  const { compactStep, setCompactStep, handleOpenChange } =
    useThreadActionsMenuLifecycle();

  return (
    <CompactLongPressMenu
      label="Thread actions"
      onOpenChange={handleOpenChange}
      items={
        <ThreadActionsMenuItems
          thread={thread}
          compactStep={compactStep}
          onCompactStepChange={setCompactStep}
        />
      }
    >
      {children}
    </CompactLongPressMenu>
  );
}
