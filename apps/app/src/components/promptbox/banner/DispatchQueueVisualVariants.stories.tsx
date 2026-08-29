import type { ReactNode } from "react";
import type { PromptInput, ThreadQueuedMessage } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { QueuedMessagesList } from "@/components/promptbox/banner/QueuedMessagesList";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/Dispatch Queue Visual Variants",
};

const noop = () => {};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// The wait line reads the real clock through `useSecondTick`, so every
// scheduled instant is derived from an anchor taken when the story module
// loads. A fixed epoch would render "Scheduled for Jan 1 1970" and no
// countdown at all.
const STORY_NOW = Date.now();

function textContent(text: string): PromptInput[] {
  return [{ type: "text", text, mentions: [] }];
}

function makeQueuedMessage(
  overrides: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  const base: ThreadQueuedMessage = {
    id: "q_default",
    threadId: "thr_dispatch_queue",
    content: textContent("Queued follow-up."),
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    sendAt: null,
    waitingOn: null,
    failureReason: null,
    payload: { kind: "inline" },
    editable: true,
    createdAt: STORY_NOW - 4 * MINUTE_MS,
    updatedAt: STORY_NOW - 4 * MINUTE_MS,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// The state inventory, one fixture per condition that can park or move a row.
// ---------------------------------------------------------------------------

/**
 * Ordinary follow-ups behind a running turn. `thread-busy` is the wait the
 * server records for them and the one wait that deliberately renders no line —
 * these rows must stay exactly one line tall.
 */
const PLAIN_QUEUE: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_plain_1",
    content: textContent("Also audit the empty queue handoff before wrapping up."),
    waitingOn: { kind: "thread-busy" },
  }),
  makeQueuedMessage({
    id: "q_plain_2",
    content: textContent("Then verify the narrow drawer on iOS Safari."),
    waitingOn: { kind: "thread-busy" },
  }),
  makeQueuedMessage({
    id: "q_plain_3",
    content: textContent("Post a concise summary when the checks finish."),
    waitingOn: { kind: "thread-busy" },
  }),
];

const SCHEDULED = makeQueuedMessage({
  id: "q_scheduled",
  content: textContent("Run the release checks and post the summary."),
  waitingOn: { kind: "time" },
  sendAt: STORY_NOW + 3 * HOUR_MS + 12 * MINUTE_MS,
});

const SCHEDULED_SOON = makeQueuedMessage({
  id: "q_scheduled_soon",
  content: textContent("Kick off the nightly benchmark sweep."),
  waitingOn: { kind: "time" },
  sendAt: STORY_NOW + 45 * 1000,
});

const WAITING_FOR_WORKSPACE = makeQueuedMessage({
  id: "q_provisioning",
  content: textContent("Re-run the setup checks after the workspace is ready."),
  waitingOn: { kind: "provisioning" },
});

const WAITING_FOR_REPLY = makeQueuedMessage({
  id: "q_interaction",
  content: textContent("Use the selected release region in the deployment plan."),
  waitingOn: { kind: "interaction" },
});

const HOST_OFFLINE = makeQueuedMessage({
  id: "q_host_offline",
  content: textContent("Capture the Safari trace on M4."),
  waitingOn: { kind: "host-offline", hostName: "M4" },
});

const PLUGIN_HELD = makeQueuedMessage({
  id: "q_plugin_held",
  content: textContent("Run the browser matrix against the candidate build."),
  waitingOn: {
    kind: "plugin",
    pluginId: "concurrency-limit",
    reason: "4 of 4 running",
  },
});

const PLUGIN_HELD_STALE = makeQueuedMessage({
  id: "q_plugin_stale",
  content: textContent("Build the simulator bundle and capture the drawer trace."),
  waitingOn: {
    kind: "plugin",
    pluginId: "mobile-lab",
    reason: "no update for 12m",
  },
});

/**
 * A retry carries the original blocks agent-only, so the row has no message to
 * quote and prints its origin instead. It is never editable, and its wait is
 * always the retry policy's.
 */
const RETRY = makeQueuedMessage({
  id: "q_retry",
  content: [
    {
      type: "text",
      text: "Deploy the release candidate to staging.",
      mentions: [],
      visibility: "agent-only",
    },
  ],
  payload: {
    kind: "retry",
    retryOfTurnRequestId: "creq_2m4kq7bxvn",
    attempt: 2,
  },
  waitingOn: {
    kind: "plugin",
    pluginId: "provider-retry",
    reason: "Rate limited",
  },
  sendAt: STORY_NOW + 18 * MINUTE_MS,
  editable: false,
  createdAt: STORY_NOW - 22 * MINUTE_MS,
});

const FAILED = makeQueuedMessage({
  id: "q_failed",
  content: textContent("Post a concise summary when the checks finish."),
  waitingOn: { kind: "thread-busy" },
  failureReason: "Thread stopped before the message could dispatch",
});

const IN_FLIGHT = makeQueuedMessage({
  id: "q_in_flight",
  content: textContent("Also audit the empty queue handoff before wrapping up."),
  waitingOn: { kind: "thread-busy" },
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface QueueScenario {
  id: string;
  label: string;
  context: string;
  /** Renders the surface at the phone stage width, where rows collapse their
   *  inline actions into the overflow menu. */
  narrow?: boolean;
  queuedMessages: readonly ThreadQueuedMessage[];
  processingMessageId?: string;
  processingAction?: "send" | "edit" | "delete";
  sendDisabled?: boolean;
  actionDisabled?: boolean;
}

function QueueStage({
  children,
  narrow,
}: {
  children: ReactNode;
  narrow: boolean;
}) {
  // The surface carries a -mb-5 so it can tuck under the composer; neutralize
  // it here so grid neighbors do not overlap.
  return (
    <div
      data-promptbox-shell=""
      className={cn("min-w-0 pb-5", narrow && "w-[20rem]")}
    >
      {children}
    </div>
  );
}

function ScenarioQueue({ scenario }: { scenario: QueueScenario }) {
  return (
    <QueueStage narrow={scenario.narrow ?? false}>
      <QueuedMessagesList
        queuedMessages={scenario.queuedMessages}
        sendDisabled={scenario.sendDisabled ?? false}
        actionDisabled={scenario.actionDisabled ?? false}
        processingMessageId={scenario.processingMessageId ?? null}
        processingAction={scenario.processingAction ?? null}
        onSendImmediately={noop}
        onReorder={noop}
        onSetGroupBoundary={noop}
        onEdit={noop}
        onDelete={noop}
      />
    </QueueStage>
  );
}

function ScenarioGrid({ scenarios }: { scenarios: readonly QueueScenario[] }) {
  return (
    <div className="grid w-full min-w-0 gap-4 xl:grid-cols-2">
      {scenarios.map((scenario) => (
        <div key={scenario.id} className="min-w-0">
          <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
              {scenario.label}
            </span>
            <span className="truncate text-2xs text-subtle-foreground">
              {scenario.context}
            </span>
          </div>
          <ScenarioQueue scenario={scenario} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

const DIRECTION_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "ordinary",
    label: "Active thread",
    context: "Ordinary follow-ups in insertion order",
    queuedMessages: PLAIN_QUEUE,
  },
  {
    id: "provisioning",
    label: "Workspace changing",
    context: "A steer waiting for reprovisioning",
    queuedMessages: [WAITING_FOR_WORKSPACE],
  },
  {
    id: "concurrency",
    label: "First dispatch",
    context: "A new thread held by a concurrency policy",
    queuedMessages: [PLUGIN_HELD],
  },
  {
    id: "scheduled-narrow",
    label: "Narrow · scheduled",
    context: "A scheduled first message at phone width",
    narrow: true,
    queuedMessages: [SCHEDULED],
  },
];

export function RowDirections() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="Adaptive detail"
        hint="The one-line row stays intact until a real wait needs explaining; only then does the row grow a status line."
      >
        <ScenarioGrid scenarios={DIRECTION_SCENARIOS} />
      </StoryRow>
      <StoryRow
        label="Queue order"
        hint="Rows render in queue order; drag a row's grip to reorder, and the divider to move the send-together boundary."
      >
        <ScenarioQueue
          scenario={{
            id: "order",
            label: "order",
            context: "",
            queuedMessages: PLAIN_QUEUE,
          }}
        />
      </StoryRow>
    </StoryCard>
  );
}

const STEER_WAIT_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "steer-provisioning",
    label: "Provisioning",
    context: "The workspace is being recreated",
    queuedMessages: [WAITING_FOR_WORKSPACE],
  },
  {
    id: "steer-interaction",
    label: "Pending interaction",
    context: "The active turn needs the user's answer",
    queuedMessages: [WAITING_FOR_REPLY],
  },
  {
    id: "steer-offline",
    label: "Host offline",
    context: "The active turn cannot reach its enrolled host",
    queuedMessages: [HOST_OFFLINE],
  },
];

const FIRST_DISPATCH_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "first-scheduled",
    label: "Scheduled · hours out",
    context: "Coarse countdown beside the scheduled instant",
    queuedMessages: [SCHEDULED],
  },
  {
    id: "first-scheduled-soon",
    label: "Scheduled · due shortly",
    context: "The countdown ticks per second under a minute",
    queuedMessages: [SCHEDULED_SOON],
  },
  {
    id: "first-plugin",
    label: "Plugin hold",
    context: "A plugin names why it is holding the dispatch",
    queuedMessages: [PLUGIN_HELD],
  },
  {
    id: "first-plugin-stale",
    label: "Plugin hold · stale",
    context: "The plugin has stopped reporting progress",
    queuedMessages: [PLUGIN_HELD_STALE],
  },
  {
    id: "first-retry",
    label: "Retry",
    context: "A failed turn parked by reference; no message, not editable",
    queuedMessages: [RETRY],
  },
];

export function RealisticWaitScenarios() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="Steers that wait"
        hint="The three physical conditions that park a steer. None of them offers Send now — the button cannot clear any of these waits."
      >
        <ScenarioGrid scenarios={STEER_WAIT_SCENARIOS} />
      </StoryRow>
      <StoryRow
        label="First dispatch"
        hint="Scheduled, plugin-held, and retry rows. Send now stays available here because skipping the schedule or the plugin pass genuinely clears the wait."
      >
        <ScenarioGrid scenarios={FIRST_DISPATCH_SCENARIOS} />
      </StoryRow>
    </StoryCard>
  );
}

const IN_FLIGHT_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "state-rest",
    label: "At rest",
    context: "Actions stay hidden until hover or focus",
    queuedMessages: [SCHEDULED],
  },
  {
    id: "state-sending",
    label: "Sending",
    context: "The row's own dispatch is in flight; actions withdraw",
    queuedMessages: [IN_FLIGHT],
    processingMessageId: IN_FLIGHT.id,
    processingAction: "send",
  },
  {
    id: "state-deleting",
    label: "Deleting",
    context: "The same line, labelled for the action in flight",
    queuedMessages: [IN_FLIGHT],
    processingMessageId: IN_FLIGHT.id,
    processingAction: "delete",
  },
  {
    id: "state-failed",
    label: "Failed",
    context: "The failure replaces the wait line and turns it destructive",
    queuedMessages: [FAILED],
  },
  {
    id: "state-send-disabled",
    label: "Send disabled",
    context: "Runtime busy — Send now greys out, edit and delete do not",
    queuedMessages: PLAIN_QUEUE,
    sendDisabled: true,
  },
  {
    id: "state-actions-disabled",
    label: "All actions disabled",
    context: "A queue-wide mutation is in flight",
    queuedMessages: PLAIN_QUEUE,
    actionDisabled: true,
  },
];

export function InteractionStates() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="Row states"
        hint="Each state is isolated so the layout does not imply a queue order. Hover is CSS-only and cannot be pinned from props — hover a row to see its actions."
      >
        <ScenarioGrid scenarios={IN_FLIGHT_SCENARIOS} />
      </StoryRow>
      {/* Inline editing is omitted: the editor slot takes live composer wiring
          (draft state, typeahead, attachment upload) that a faked stand-in
          would misrepresent. */}
    </StoryCard>
  );
}

const NARROW_SCENARIOS: readonly QueueScenario[] = [
  {
    id: "narrow-plain",
    label: "Narrow · queue",
    context: "Inline actions collapse into the overflow menu below md",
    narrow: true,
    queuedMessages: PLAIN_QUEUE,
  },
  {
    id: "narrow-wait",
    label: "Narrow · parked",
    context: "The wait line truncates rather than wrapping",
    narrow: true,
    queuedMessages: [PLUGIN_HELD_STALE],
  },
  {
    id: "narrow-retry",
    label: "Narrow · retry",
    context: "No Edit entry in the overflow menu for a retry",
    narrow: true,
    queuedMessages: [RETRY],
  },
  {
    id: "narrow-failed",
    label: "Narrow · failed",
    context: "The failure reason truncates on one line",
    narrow: true,
    queuedMessages: [FAILED],
  },
];

export function NarrowSurface() {
  return (
    <StoryCard labelWidth="180px">
      <StoryRow
        label="Phone width"
        hint="The compact row typography is what the drawer always uses; the roomier workspace variant is reached with the header caret."
      >
        <ScenarioGrid scenarios={NARROW_SCENARIOS} />
      </StoryRow>
    </StoryCard>
  );
}
