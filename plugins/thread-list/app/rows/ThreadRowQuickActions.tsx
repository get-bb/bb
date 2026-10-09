import { useState } from "react";
import {
  experimental_Icon as RegisteredIcon,
  type PluginThreadActionEntry,
} from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { cn } from "@/lib/utils";

function ThreadQuickActionButton({
  entry,
  className,
}: {
  entry: PluginThreadActionEntry;
  className?: string;
}) {
  const [isRunning, setIsRunning] = useState(false);
  const { action } = entry;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("rounded-md p-0", className)}
          aria-label={action.label}
          data-thread-action={entry.key}
          disabled={action.disabled || isRunning}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsRunning(true);
            void action.run().finally(() => setIsRunning(false));
          }}
        >
          <RegisteredIcon
            name={action.icon}
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{action.label}</TooltipContent>
    </Tooltip>
  );
}

function ThreadQuickActionChoices({
  entry,
  className,
  onOpenChange,
}: {
  entry: PluginThreadActionEntry;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { action } = entry;
  const choices = action.choices;
  if (choices === undefined) return null;
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
              aria-label={action.label}
              data-thread-action={entry.key}
              disabled={action.disabled}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <RegisteredIcon
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
        className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto"
      >
        <DropdownMenuLabel>{choices.heading ?? action.label}</DropdownMenuLabel>
        {choices.hint !== undefined ? (
          <div className="px-2 pb-1 text-xs text-muted-foreground">
            {choices.hint}
          </div>
        ) : null}
        {choices.items.map((choice) => (
          <DropdownMenuItem
            key={choice.id}
            aria-current={choice.selected ? "true" : undefined}
            className="flex items-center justify-between gap-3"
            disabled={choice.disabled}
            onSelect={() => {
              void action.run(choice.id);
            }}
          >
            {choice.icon !== undefined ? (
              <RegisteredIcon name={choice.icon} aria-hidden="true" />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{choice.label}</span>
            {choice.selected ? (
              <Icon name="Check" className="ml-auto" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadRowQuickActions({
  entries,
  className,
  onMenuOpenChange,
}: {
  entries: readonly PluginThreadActionEntry[];
  className?: string;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  return entries.map((entry) =>
    entry.action.choices === undefined ? (
      <ThreadQuickActionButton
        key={entry.key}
        entry={entry}
        className={className}
      />
    ) : (
      <ThreadQuickActionChoices
        key={entry.key}
        entry={entry}
        className={className}
        onOpenChange={onMenuOpenChange}
      />
    ),
  );
}
