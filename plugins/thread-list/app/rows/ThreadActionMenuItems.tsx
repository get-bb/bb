import type { PluginThreadActionItem } from "@get-bb/plugin-sdk/app";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { cn } from "@/lib/utils";
import { ActionMenuItem } from "../ui/action-menu-items.js";

export type ThreadActionMenuSurface = "context" | "dropdown";

const GROUP_ORDER = ["open", "organize", "lifecycle"] as const;
const CHOICES_CONTENT_CLASS =
  "max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto";

export function groupThreadActionItems(
  items: readonly PluginThreadActionItem[],
): PluginThreadActionItem[][] {
  return GROUP_ORDER.map((group) =>
    items.filter((item) => item.action.group === group),
  ).filter((group) => group.length > 0);
}

export function runThreadAction(
  item: PluginThreadActionItem,
  run: () => void | Promise<void>,
): void {
  const describe = () => `thread action "${item.key}" failed`;
  try {
    const result = run();
    if (result instanceof Promise) {
      result.catch((error: unknown) => console.error(describe(), error));
    }
  } catch (error) {
    console.error(describe(), error);
  }
}

function ThreadActionChoiceRows({
  item,
  surface,
}: {
  item: PluginThreadActionItem;
  surface: ThreadActionMenuSurface;
}) {
  const choices = item.action.choices;
  if (choices === undefined) return null;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return choices.items.map((choice) => (
    <Item
      key={choice.id}
      aria-current={choice.selected ? "true" : undefined}
      className="flex items-center justify-between gap-3"
      disabled={choice.disabled}
      onSelect={() => {
        runThreadAction(item, () => choices.select(choice.id));
      }}
    >
      {choice.icon !== undefined ? (
        <Icon name={choice.icon} aria-hidden="true" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{choice.label}</span>
      {choice.selected ? (
        <Icon name="Check" className="ml-auto" aria-hidden="true" />
      ) : null}
    </Item>
  ));
}

function ThreadActionChoicesHeading({
  item,
  surface,
}: {
  item: PluginThreadActionItem;
  surface: ThreadActionMenuSurface;
}) {
  const choices = item.action.choices;
  if (choices === undefined) return null;
  const heading = choices.heading ?? item.action.label;
  const Label = surface === "context" ? ContextMenuLabel : DropdownMenuLabel;
  return (
    <>
      <Label>{heading}</Label>
      {choices.hint !== undefined ? (
        <div className="px-2 pb-1 text-xs text-muted-foreground">
          {choices.hint}
        </div>
      ) : null}
    </>
  );
}

export function ThreadActionMenuRows({
  items,
  surface,
  isDrawer,
  onOpenDrawerStep,
}: {
  items: readonly PluginThreadActionItem[];
  surface: ThreadActionMenuSurface;
  isDrawer: boolean;
  onOpenDrawerStep?: (key: string) => void;
}) {
  return items.map((item) => {
    const { action } = item;
    if (action.choices === undefined) {
      return (
        <ActionMenuItem
          key={item.key}
          surface={surface}
          icon={action.icon}
          variant={action.variant}
          disabled={action.disabled}
          onSelect={() => {
            runThreadAction(item, () => action.run?.());
          }}
        >
          {action.label}
        </ActionMenuItem>
      );
    }
    if (isDrawer) {
      return (
        <DropdownMenuItem
          key={item.key}
          disabled={action.disabled}
          onSelect={(event) => {
            event.preventDefault();
            onOpenDrawerStep?.(item.key);
          }}
        >
          <Icon name={action.icon} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
          <Icon name="ChevronRight" className="ml-auto" aria-hidden="true" />
        </DropdownMenuItem>
      );
    }
    const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
    const SubTrigger =
      surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
    const SubContent =
      surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
    return (
      <Sub key={item.key}>
        <SubTrigger disabled={action.disabled}>
          <Icon name={action.icon} aria-hidden="true" />
          {action.label}
        </SubTrigger>
        <SubContent className={CHOICES_CONTENT_CLASS}>
          {action.choices.heading !== undefined ||
          action.choices.hint !== undefined ? (
            <ThreadActionChoicesHeading item={item} surface={surface} />
          ) : null}
          <ThreadActionChoiceRows item={item} surface={surface} />
        </SubContent>
      </Sub>
    );
  });
}

export function ThreadActionDrawerStep({
  item,
  onBack,
}: {
  item: PluginThreadActionItem;
  onBack: () => void;
}) {
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        <Icon name="ChevronLeft" aria-hidden="true" />
        Back
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <ThreadActionChoicesHeading item={item} surface="dropdown" />
      <ThreadActionChoiceRows item={item} surface="dropdown" />
    </>
  );
}

export function ThreadActionButton({
  item,
  className,
  onMenuOpenChange,
}: {
  item: PluginThreadActionItem;
  className?: string;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const { action } = item;
  if (action.choices === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("rounded-md p-0", className)}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              runThreadAction(item, () => action.run?.());
            }}
          >
            <Icon name={action.icon} className={COARSE_POINTER_ICON_SIZE_CLASS} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{action.label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <DropdownMenu onOpenChange={onMenuOpenChange}>
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
              aria-label={action.label}
              disabled={action.disabled}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <Icon
                name={action.icon}
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{action.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className={CHOICES_CONTENT_CLASS}
      >
        <ThreadActionChoicesHeading item={item} surface="dropdown" />
        <ThreadActionChoiceRows item={item} surface="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
