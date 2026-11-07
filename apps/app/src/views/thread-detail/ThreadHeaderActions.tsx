import { useState, type ReactNode } from "react";
import type {
  PluginThreadActionEntry,
  PluginThreadActionsInlineItem,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { Button, buttonVariants } from "@bb/shared-ui/button";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  ThreadActionBadgeMark,
  threadActionAccessibleName,
} from "@/components/thread/ThreadActionBadge";
import {
  ThreadActionChoiceRows,
  ThreadActionChoicesHint,
} from "@/components/thread/ThreadActionMenuItems";
import { SplitButton } from "@/components/ui/split-button.js";
import { CORE_THREAD_ACTION_OWNER } from "@/lib/thread-actions/thread-action-registry";

export const THREAD_HEADER_ACTIONS_GROUP = "0_header";

const THREAD_HEADER_ACTION_BUTTON_CLASS = cn(
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS,
  "border-border/70 bg-transparent font-normal hover:bg-state-hover",
);
const ICON_DISPLAY_CLASS = cn(
  "px-1 shadow-none",
  CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
);
const CHOICES_CONTENT_CLASS =
  "max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto";

type HeaderAction = PluginThreadActionEntry["action"];

function isPlainLabelAction(action: HeaderAction): boolean {
  return (
    (action.display ?? "label") === "label" &&
    action.badge === undefined &&
    action.choices === undefined &&
    action.popover === undefined
  );
}

function tooltipText(action: HeaderAction): string | null {
  if (
    action.display !== "icon" &&
    action.badge === undefined &&
    action.detail === undefined
  ) {
    return null;
  }
  return [threadActionAccessibleName(action), action.detail]
    .filter((part) => part !== undefined)
    .join(" · ");
}

function buttonClass(action: HeaderAction): string {
  return cn(
    THREAD_HEADER_ACTION_BUTTON_CLASS,
    "gap-1.5",
    action.display === "icon" && ICON_DISPLAY_CLASS,
  );
}

function usePendingRun(): [boolean, (run: () => Promise<void>) => void] {
  const [pending, setPending] = useState(false);
  return [
    pending,
    (run) => {
      if (pending) return;
      setPending(true);
      void run().finally(() => setPending(false));
    },
  ];
}

function HeaderActionContent({
  action,
  pending = false,
  trailing,
}: {
  action: HeaderAction;
  pending?: boolean;
  trailing?: ReactNode;
}) {
  const display = action.display ?? "label";
  return (
    <>
      {display === "label" ? null : (
        <Icon
          name={action.icon}
          aria-hidden="true"
          className={cn("size-4", pending && "animate-shine-icon")}
        />
      )}
      {display === "icon" ? null : (
        <span className="max-w-48 truncate">{action.label}</span>
      )}
      {action.badge === undefined ? null : (
        <ThreadActionBadgeMark badge={action.badge} />
      )}
      {trailing}
    </>
  );
}

function OptionalTooltip({
  text,
  children,
}: {
  text: string | null;
  children: ReactNode;
}) {
  if (text === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function RunHeaderAction({ entry }: { entry: PluginThreadActionEntry }) {
  const { action } = entry;
  const [pending, startRun] = usePendingRun();
  return (
    <OptionalTooltip text={tooltipText(action)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={buttonClass(action)}
        aria-label={threadActionAccessibleName(action)}
        aria-busy={pending || undefined}
        disabled={action.disabled === true || pending}
        onClick={() => startRun(() => action.run())}
      >
        <HeaderActionContent action={action} pending={pending} />
      </Button>
    </OptionalTooltip>
  );
}

function ChoicesHeaderAction({ entry }: { entry: PluginThreadActionEntry }) {
  const { action } = entry;
  const [pending, startRun] = usePendingRun();
  const choices = action.choices;
  if (choices === undefined) return null;
  const choiceEntry: PluginThreadActionEntry = {
    ...entry,
    action: {
      ...action,
      run: (value) => {
        startRun(() => action.run(value));
        return Promise.resolve();
      },
    },
  };
  const menu = (
    <DropdownMenuContent
      align="end"
      sideOffset={2}
      mobileTitle={choices.heading ?? action.label}
      className={CHOICES_CONTENT_CLASS}
    >
      <ThreadActionChoiceRows entry={choiceEntry} surface="dropdown" />
      <ThreadActionChoicesHint entry={choiceEntry} surface="dropdown" />
    </DropdownMenuContent>
  );
  if (choices.split === true) {
    return (
      <div className="inline-flex items-center">
        <OptionalTooltip text={tooltipText(action)}>
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              buttonClass(action),
              "rounded-r-none border-r-0 pr-1 focus-visible:z-10",
            )}
            aria-label={threadActionAccessibleName(action)}
            aria-busy={pending || undefined}
            disabled={action.disabled === true || pending}
            onClick={() => startRun(() => action.run())}
          >
            <HeaderActionContent action={action} pending={pending} />
          </button>
        </OptionalTooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                buttonClass(action),
                "rounded-l-none border-l-0 px-1 focus-visible:z-10",
                "aria-expanded:bg-state-active aria-expanded:text-foreground",
              )}
              aria-label={choices.heading ?? `More ${action.label} options`}
              disabled={action.disabled === true || pending}
            >
              <Icon name="ChevronDown" className="size-3" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <OptionalTooltip text={tooltipText(action)}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              buttonClass(action),
              "aria-expanded:bg-state-active aria-expanded:text-foreground",
            )}
            aria-label={threadActionAccessibleName(action)}
            aria-busy={pending || undefined}
            disabled={action.disabled === true || pending}
          >
            <HeaderActionContent
              action={action}
              pending={pending}
              trailing={
                <Icon
                  name="ChevronDown"
                  className="-ml-0.5 size-3"
                  aria-hidden="true"
                />
              }
            />
          </Button>
        </DropdownMenuTrigger>
      </OptionalTooltip>
      {menu}
    </DropdownMenu>
  );
}

export function ThreadHeaderActionPopoverContent({
  entry,
  thread,
  close,
}: {
  entry: PluginThreadActionEntry;
  thread: PluginThreadActionTarget;
  close: () => void;
}) {
  const PopoverBody = entry.action.popover;
  if (PopoverBody === undefined) return null;
  const content = <PopoverBody thread={thread} close={close} />;
  return (
    <PopoverContent
      align="end"
      mobileTitle={entry.action.label}
      className="max-h-[min(36rem,calc(100dvh-6rem))] w-80 overflow-y-auto p-2"
      data-thread-header-action-popover={entry.key}
    >
      {entry.pluginId === CORE_THREAD_ACTION_OWNER ? (
        content
      ) : (
        <PluginSlotMount
          pluginId={entry.pluginId}
          slotKind="threadHeaderActionPopover"
          slotId={entry.key}
          instanceId={thread.id}
          crashFallback={null}
        >
          {content}
        </PluginSlotMount>
      )}
    </PopoverContent>
  );
}

function PopoverHeaderAction({
  entry,
  thread,
}: {
  entry: PluginThreadActionEntry;
  thread: PluginThreadActionTarget;
}) {
  const { action } = entry;
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <OptionalTooltip text={tooltipText(action)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              buttonClass(action),
              "aria-expanded:bg-state-active aria-expanded:text-foreground",
            )}
            aria-label={threadActionAccessibleName(action)}
            disabled={action.disabled === true}
          >
            <HeaderActionContent action={action} />
          </Button>
        </PopoverTrigger>
      </OptionalTooltip>
      {open ? (
        <ThreadHeaderActionPopoverContent
          entry={entry}
          thread={thread}
          close={() => setOpen(false)}
        />
      ) : null}
    </Popover>
  );
}

function PlainHeaderActions({
  entries,
}: {
  entries: readonly PluginThreadActionEntry[];
}) {
  const [primary, ...secondary] = entries;
  if (primary === undefined) return null;
  if (secondary.length === 0) return <RunHeaderAction entry={primary} />;
  return (
    <SplitButton
      className={THREAD_HEADER_ACTION_BUTTON_CLASS}
      primaryAction={{
        disabled: primary.action.disabled,
        label: primary.action.label,
        onSelect: () => void primary.action.run(),
      }}
      secondaryActions={secondary.map(({ key, action }) => ({
        id: key,
        disabled: action.disabled,
        label: action.label,
        onSelect: () => void action.run(),
      }))}
    />
  );
}

function RichHeaderAction({
  entry,
  thread,
}: {
  entry: PluginThreadActionEntry;
  thread: PluginThreadActionTarget;
}) {
  if (entry.action.popover !== undefined) {
    return <PopoverHeaderAction entry={entry} thread={thread} />;
  }
  if (entry.action.choices !== undefined) {
    return <ChoicesHeaderAction entry={entry} />;
  }
  return <RunHeaderAction entry={entry} />;
}

export function ThreadHeaderActions({
  entries,
  thread,
}: {
  entries: readonly PluginThreadActionEntry[];
  thread: PluginThreadActionTarget;
}) {
  const plain = entries.filter((entry) => isPlainLabelAction(entry.action));
  return entries.map((entry) => {
    if (isPlainLabelAction(entry.action) && entry !== plain[0]) return null;
    return (
      <span
        key={entry.key}
        className="inline-flex"
        data-thread-header-responsive-action=""
        data-thread-header-action={entry.key}
      >
        {isPlainLabelAction(entry.action) ? (
          <PlainHeaderActions entries={plain} />
        ) : (
          <RichHeaderAction entry={entry} thread={thread} />
        )}
      </span>
    );
  });
}

export function threadHeaderActionInlineItems(
  entries: readonly PluginThreadActionEntry[],
  openPopover: (key: string) => void,
): PluginThreadActionsInlineItem[] {
  return entries.map(({ key, action }) => {
    const { popover, run, ...rest } = action;
    return {
      key,
      group: THREAD_HEADER_ACTIONS_GROUP,
      action: {
        ...rest,
        run:
          popover === undefined
            ? ({ value }) => run(value)
            : () => {
                window.setTimeout(() => openPopover(key), 0);
              },
      },
    };
  });
}
