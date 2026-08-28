import { useState } from "react";
import type { PromptTextMention } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  makeAttachmentsConfig as makeAttachments,
  makeTypeaheadConfig as makeTypeahead,
} from "../../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { InlineMessageEditorFrame } from "../InlineMessageEditorFrame";
import { PromptBoxInternal } from "../PromptBoxInternal";
import { PromptStackCard } from "./PromptStackCard";

export default {
  title: "promptbox/banner/Dispatch Queue Visual Variants",
};

type QueueRowState = "rest" | "hover" | "editing" | "sending" | "failed";

interface QueuePrototypeItem {
  id: string;
  icon: IconName | null;
  message: string | null;
  fallbackTitle: string | null;
  status: string | null;
  canEdit: boolean;
  canSendNow: boolean;
  state: QueueRowState;
  failureReason: string | null;
}

interface QueueScenario {
  id: string;
  label: string;
  context: string;
  compact: boolean;
  items: readonly QueuePrototypeItem[];
}

const noop = () => {};

function queueItem(
  item: Pick<QueuePrototypeItem, "id" | "message"> &
    Partial<QueuePrototypeItem>,
): QueuePrototypeItem {
  return {
    icon: null,
    fallbackTitle: null,
    status: null,
    canEdit: true,
    canSendNow: true,
    state: "rest",
    failureReason: null,
    ...item,
  };
}

const ORDINARY_QUEUE: readonly QueuePrototypeItem[] = [
  queueItem({
    id: "ordinary-audit",
    message: "Also audit the empty queue handoff before wrapping up.",
  }),
  queueItem({
    id: "ordinary-drawer",
    message: "Then verify the narrow drawer on iOS Safari.",
  }),
  queueItem({
    id: "ordinary-summary",
    message: "Post a concise summary when the checks finish.",
  }),
];

const PROVISIONING_STEER = queueItem({
  id: "provisioning-steer",
  icon: "Folder",
  message: "Re-run the setup checks after the workspace is ready.",
  status: "Waiting for workspace",
  canSendNow: false,
});

const INTERACTION_STEER = queueItem({
  id: "interaction-steer",
  icon: "CircleQuestion",
  message: "Use the selected release region in the deployment plan.",
  status: "Waiting for your reply",
  canSendNow: false,
});

const OFFLINE_STEER = queueItem({
  id: "offline-steer",
  icon: "CloudOff",
  message: "Capture the Safari trace on M4.",
  status: "Waiting for M4 to reconnect",
  canSendNow: false,
});

const SCHEDULED_START = queueItem({
  id: "scheduled-start",
  icon: "TimeSchedule",
  message: "Run the release checks and post the summary.",
  status: "Scheduled for 9:00 PM · in 3h",
});

const CONCURRENCY_START = queueItem({
  id: "concurrency-start",
  icon: "Limitation",
  message: "Run the browser matrix against the candidate build.",
  status: "Held by concurrency-limit · 4 of 4 running",
});

const SANDBOX_START = queueItem({
  id: "sandbox-start",
  icon: "Cloud",
  message: "Boot a clean sandbox and validate host enrollment.",
  status: "Creating sandbox · about 2m",
});

const STALE_PLUGIN_START = queueItem({
  id: "stale-plugin-start",
  icon: "AlertCircle",
  message: "Build the simulator bundle and capture the drawer trace.",
  status: "Held by mobile-lab · no update for 12m",
});

const RETRY_START = queueItem({
  id: "retry-start",
  icon: "RotateCcw",
  message: null,
  fallbackTitle: "Retry failed turn from 6:12 PM",
  status: "Rate limited · retrying at 6:30 PM · attempt 2",
  canEdit: false,
  canSendNow: false,
});

const DIRECTION_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "ordinary",
    label: "Active thread",
    context: "Ordinary follow-ups in insertion order",
    compact: false,
    items: ORDINARY_QUEUE,
  },
  {
    id: "provisioning",
    label: "Workspace changing",
    context: "A steer waiting for reprovisioning",
    compact: false,
    items: [PROVISIONING_STEER],
  },
  {
    id: "concurrency",
    label: "First dispatch",
    context: "A new thread held by a concurrency policy",
    compact: false,
    items: [CONCURRENCY_START],
  },
  {
    id: "scheduled",
    label: "Narrow · scheduled",
    context: "A scheduled first message",
    compact: true,
    items: [SCHEDULED_START],
  },
];

const STEER_WAIT_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "steer-provisioning",
    label: "Provisioning",
    context: "The workspace is being recreated",
    compact: false,
    items: [PROVISIONING_STEER],
  },
  {
    id: "steer-interaction",
    label: "Pending interaction",
    context: "The active turn needs the user's answer",
    compact: false,
    items: [INTERACTION_STEER],
  },
  {
    id: "steer-offline",
    label: "Host offline",
    context: "The active turn cannot reach its enrolled host",
    compact: false,
    items: [OFFLINE_STEER],
  },
];

const FIRST_DISPATCH_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "first-scheduled",
    label: "Scheduled",
    context: "The thread has not started yet",
    compact: false,
    items: [SCHEDULED_START],
  },
  {
    id: "first-concurrency",
    label: "Concurrency policy",
    context: "The first dispatch is held by a plugin",
    compact: false,
    items: [CONCURRENCY_START],
  },
  {
    id: "first-sandbox",
    label: "Sandbox provisioning",
    context: "The plugin is actively preparing the environment",
    compact: false,
    items: [SANDBOX_START],
  },
  {
    id: "first-stale",
    label: "Stale plugin hold",
    context: "The plugin has stopped reporting progress",
    compact: false,
    items: [STALE_PLUGIN_START],
  },
  {
    id: "first-retry",
    label: "Retry",
    context: "A failed turn is parked by reference",
    compact: false,
    items: [RETRY_START],
  },
];

const INTERACTION_ITEMS: readonly QueuePrototypeItem[] = [
  queueItem({ ...SCHEDULED_START, id: "at-rest" }),
  queueItem({ ...CONCURRENCY_START, id: "hover", state: "hover" }),
  queueItem({ ...ORDINARY_QUEUE[0], id: "editing", state: "editing" }),
  queueItem({ ...ORDINARY_QUEUE[0], id: "sending", state: "sending" }),
  queueItem({
    ...ORDINARY_QUEUE[0],
    id: "failed",
    state: "failed",
    failureReason: "Thread stopped before the message could dispatch",
  }),
];

const INTERACTION_LABELS = [
  ["At rest", "Scheduled row without hover"],
  ["Hover", "Actions forced visible"],
  ["Editing", "The production inline prompt editor"],
  ["Sending", "Transient dispatch state"],
  ["Failed", "Recoverable dispatch failure"],
] as const;

function QueueItemActions({
  compact,
  forceVisible,
  item,
}: {
  compact: boolean;
  forceVisible: boolean;
  item: QueuePrototypeItem;
}) {
  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={`${item.fallbackTitle ?? item.message ?? "Queued item"} actions`}
          >
            <Icon name="MoreHorizontal" className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[8rem]">
          {item.canSendNow ? (
            <DropdownMenuItem>
              <Icon name="Sent" aria-hidden />
              Send now
            </DropdownMenuItem>
          ) : null}
          {item.canEdit ? (
            <DropdownMenuItem>
              <Icon name="Edit" aria-hidden />
              Edit
            </DropdownMenuItem>
          ) : null}
          {item.canSendNow || item.canEdit ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem variant="destructive">
            <Icon name="Trash2" aria-hidden />
            Cancel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute right-2.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-surface-raised-solid pl-3 opacity-0 shadow-[-10px_0_12px_var(--surface-raised-solid)] transition-opacity",
        "group-hover/dispatch-row:pointer-events-auto group-hover/dispatch-row:opacity-100 group-focus-within/dispatch-row:pointer-events-auto group-focus-within/dispatch-row:opacity-100",
        forceVisible && "pointer-events-auto opacity-100",
      )}
    >
      {item.canSendNow ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Send now"
        >
          <Icon name="Sent" className="size-4" aria-hidden />
        </Button>
      ) : null}
      {item.canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Edit"
        >
          <Icon name="Edit" className="size-4" aria-hidden />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        aria-label="Cancel"
      >
        <Icon name="Trash2" className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function InlineEditingRow({ item }: { item: QueuePrototypeItem }) {
  const [value, setValue] = useState(item.message ?? "");
  const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);

  return (
    <div className="px-2.5 py-2">
      <InlineMessageEditorFrame
        cancelLabel="Cancel editing queued message"
        label="Editing queued message"
        onCancel={noop}
      >
        <PromptBoxInternal
          value={value}
          mentionRanges={mentionRanges}
          onChange={(nextValue, nextMentions) => {
            setValue(nextValue);
            setMentionRanges(nextMentions);
          }}
          onSubmit={noop}
          placeholder="Update queued message"
          typeahead={makeTypeahead()}
          mentionMenuPlacement="bottom"
          attachments={makeAttachments()}
          submission={{ title: "Save queued message" }}
          minHeight={72}
        />
      </InlineMessageEditorFrame>
    </div>
  );
}

function ItemStatus({ item }: { item: QueuePrototypeItem }) {
  if (item.state === "sending") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Icon name="Spinner" className="size-3 animate-spin" aria-hidden />
        Sending…
      </span>
    );
  }
  if (item.state === "failed") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-destructive-text">
        <Icon name="AlertCircle" className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{item.failureReason}</span>
      </span>
    );
  }
  return <span className="truncate">{item.status}</span>;
}

function QueueDragHandle({
  disabled,
  item,
}: {
  disabled: boolean;
  item: QueuePrototypeItem;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "-ml-2 flex h-7 w-5 shrink-0 touch-none items-center justify-center rounded-md px-0.5 text-muted-foreground",
        !disabled && "cursor-grab active:cursor-grabbing",
      )}
      disabled={disabled}
      aria-label={`Reorder ${item.fallbackTitle ?? item.message ?? "queued item"}`}
    >
      <Icon
        name="DragDropVertical"
        className={cn(
          "size-3.5 shrink-0 opacity-0 transition-opacity",
          !disabled &&
            "group-hover/dispatch-row:opacity-100 group-focus-within/dispatch-row:opacity-100 [@media(hover:none)]:opacity-100",
        )}
        aria-hidden
      />
    </Button>
  );
}

function WaitIcon({ item }: { item: QueuePrototypeItem }) {
  if (!item.icon) return null;
  return (
    <Icon
      name={item.icon}
      className="size-3 shrink-0 text-muted-foreground"
      aria-hidden
    />
  );
}

function AdaptiveRow({
  compact,
  item,
}: {
  compact: boolean;
  item: QueuePrototypeItem;
}) {
  const title = item.message ?? item.fallbackTitle ?? "Queued work";
  const hasStatus = item.status !== null || item.state !== "rest";
  const isSending = item.state === "sending";
  return (
    <li className="group/dispatch-row relative border-b border-border/35 px-2.5 py-0.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <QueueDragHandle disabled={isSending} item={item} />
        <div className={cn("min-w-0 flex-1 py-1", hasStatus && "py-1.5")}>
          <p className="truncate text-xs text-foreground" title={title}>
            {title}
          </p>
          {hasStatus ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-2xs text-subtle-foreground">
              <WaitIcon item={item} />
              <ItemStatus item={item} />
            </div>
          ) : null}
        </div>
        {compact && !isSending ? (
          <QueueItemActions compact forceVisible={false} item={item} />
        ) : null}
      </div>
      {!compact && !isSending ? (
        <QueueItemActions
          compact={false}
          forceVisible={item.state === "hover"}
          item={item}
        />
      ) : null}
    </li>
  );
}

function QueuePrototypeRow({
  compact,
  item,
}: {
  compact: boolean;
  item: QueuePrototypeItem;
}) {
  if (item.state === "editing") {
    return (
      <li className="border-b border-border/35 last:border-b-0">
        <InlineEditingRow item={item} />
      </li>
    );
  }
  return <AdaptiveRow compact={compact} item={item} />;
}

function QueuePrototype({
  compact,
  items,
}: {
  compact: boolean;
  items: readonly QueuePrototypeItem[];
}) {
  return (
    <PromptStackCard
      ariaLabel="Queue"
      className="overflow-hidden bg-surface-raised-solid shadow-lift"
    >
      <header className="flex h-9 items-center gap-2 border-b border-border/40 px-3">
        <span className="text-xs font-medium text-foreground">Queue</span>
        <span className="text-2xs tabular-nums text-subtle-foreground">
          {items.length}
        </span>
      </header>
      <ul>
        {items.map((item) => (
          <QueuePrototypeRow key={item.id} compact={compact} item={item} />
        ))}
      </ul>
    </PromptStackCard>
  );
}

function ScenarioGrid({ scenarios }: { scenarios: readonly QueueScenario[] }) {
  return (
    <div className="grid w-full min-w-0 gap-4 xl:grid-cols-2">
      {scenarios.map((scenario) => (
        <div
          key={scenario.id}
          className={cn("min-w-0", scenario.compact && "max-w-[20rem]")}
        >
          <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
              {scenario.label}
            </span>
            <span className="truncate text-2xs text-subtle-foreground">
              {scenario.context}
            </span>
          </div>
          <div data-promptbox-shell="">
            <QueuePrototype compact={scenario.compact} items={scenario.items} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RowDirections() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="Adaptive detail"
        hint="Today's one-line row stays intact until a real wait needs explanation."
      >
        <ScenarioGrid scenarios={DIRECTION_SCENARIOS} />
      </StoryRow>
    </StoryCard>
  );
}

export function RealisticWaitScenarios() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="Steers that wait"
        hint="Separate queues for the three physical conditions that can park a steer."
      >
        <ScenarioGrid scenarios={STEER_WAIT_SCENARIOS} />
      </StoryRow>
      <StoryRow
        label="First dispatch"
        hint="Separate queue contexts for scheduled, plugin-held, provisioning, stale, and retry cases."
      >
        <ScenarioGrid scenarios={FIRST_DISPATCH_SCENARIOS} />
      </StoryRow>
    </StoryCard>
  );
}

export function InteractionStates() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="Row states"
        hint="Each state is isolated so the layout does not imply a queue order."
      >
        <div className="grid w-full min-w-0 gap-4 xl:grid-cols-2">
          {INTERACTION_ITEMS.map((item, index) => {
            const [label, context] = INTERACTION_LABELS[index];
            return (
              <div key={item.id} className="min-w-0">
                <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
                    {label}
                  </span>
                  <span className="truncate text-2xs text-subtle-foreground">
                    {context}
                  </span>
                </div>
                <div data-promptbox-shell="">
                  <QueuePrototype compact={false} items={[item]} />
                </div>
              </div>
            );
          })}
        </div>
      </StoryRow>
    </StoryCard>
  );
}
