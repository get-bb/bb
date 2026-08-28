import { useState } from "react";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import type { DispatchHoldResponse, TimelineRow } from "@bb/server-contract";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import {
  HeldDispatchCard,
  type HeldDispatchAction,
} from "@/components/promptbox/banner/HeldDispatchCard";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/Held Dispatch",
};

// ---------------------------------------------------------------------------
// A held dispatch shows up in two places at once, and this story puts them
// side by side so the pair can be judged together:
//
//   * the card above the composer — the live control surface, with named
//     actions that are visible at rest
//   * the timeline row — the record, which opens on its own while the hold is
//     waiting so the message that is queued to send is readable without a click
//
// Wording is the third thing under review here: the internal vocabulary
// ("dispatch", "release") is not what a reader of the thread should be shown,
// so the last section lines up the candidate title sets against each other.
// ---------------------------------------------------------------------------

const THREAD_ID = "thr_held";
const NOW = Date.now();

function Stage({ children, width }: { children: React.ReactNode; width: string }) {
  return (
    <div data-promptbox-shell="" className="min-w-0" style={{ width }}>
      {children}
    </div>
  );
}

/** Desktop and a phone-width card, so the wrapping action row is visible. */
function ResponsiveStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <Stage width="34rem">{children}</Stage>
      <Stage width="20rem">{children}</Stage>
    </div>
  );
}

function TimelineStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[640px]">{children}</div>;
}

// ---- Hold fixtures --------------------------------------------------------

const EXECUTION: ResolvedThreadExecutionOptions = {
  model: "opus",
  permissionMode: "auto",
  reasoningLevel: "medium",
  serviceTier: "default",
  source: "client/turn/requested",
};

function inlinePayload(
  text: string,
  editable = true,
): DispatchHoldResponse["payload"] {
  return {
    kind: "inline",
    input: [{ type: "text", text, mentions: [] }],
    execution: EXECUTION,
    editable,
  };
}

function hold(
  overrides: Partial<DispatchHoldResponse> = {},
): DispatchHoldResponse {
  return {
    id: "hold_1",
    kind: "turn",
    threadId: THREAD_ID,
    holder: "plugin:scheduled-send",
    userReleasable: true,
    reason: "Scheduled",
    payload: inlinePayload("Hello!"),
    resumeAt: NOW + 169_000,
    expectedReleaseAt: null,
    staleAfterMs: null,
    lastReportAt: null,
    createdAt: NOW - 30_000,
    releasedAt: null,
    releaseKind: null,
    ...overrides,
  };
}

const scheduledHold = hold();

const longMessageHold = hold({
  id: "hold_long",
  payload: inlinePayload(
    "Draft the release notes for 0.9, then post them to #launches once the changelog lands.",
  ),
  resumeAt: NOW + 3_600_000 * 52,
});

/** A retry hold: nothing to edit, and core releases it on its own timer. */
const retryHold = hold({
  id: "hold_retry",
  holder: "plugin:provider-retry",
  reason: "Rate limited",
  userReleasable: false,
  payload: {
    kind: "retry",
    retryOfTurnRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
  },
  resumeAt: NOW + 412_000,
});

/** A limiter hold: no timer at all, released when a slot frees up. */
const capacityHold = hold({
  id: "hold_capacity",
  holder: "plugin:concurrency-limit",
  reason: "2 of 2 running on all hosts",
  resumeAt: null,
  expectedReleaseAt: null,
});

/** A core hold: the host went away, and its return is the release signal. */
const hostOfflineHold = hold({
  id: "hold_host",
  holder: "core:host-offline",
  reason: "Waiting for mac to reconnect",
  userReleasable: false,
  payload: inlinePayload("Hello!", false),
  resumeAt: null,
  expectedReleaseAt: null,
});

/** A hold whose owner has gone quiet past the staleness it declared. */
const staleHold = hold({
  id: "hold_stale",
  holder: "plugin:concurrency-limit",
  reason: "2 of 2 running on all hosts",
  resumeAt: null,
  expectedReleaseAt: null,
  staleAfterMs: 60_000,
  lastReportAt: NOW - 400_000,
});

function noop() {}

/**
 * The card with a stand-in for the composer's inline editor. The real one is a
 * FollowUpPromptBox owned by ThreadDetailPromptArea; a story cannot mount that
 * without the whole composer stack, so this shows the slot the card gives it.
 */
function InteractiveCard({
  actionDisabled = false,
  hold: heldDispatch,
  pendingAction = null,
}: {
  actionDisabled?: boolean;
  hold: DispatchHoldResponse;
  pendingAction?: HeldDispatchAction | null;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <HeldDispatchCard
      hold={heldDispatch}
      actionDisabled={actionDisabled}
      pendingAction={pendingAction}
      inlineEditor={
        editing
          ? {
              holdId: heldDispatch.id,
              onDismiss: () => setEditing(false),
              content: (
                <div className="rounded-md border border-border bg-background px-3 py-6 text-xs text-muted-foreground">
                  the thread composer, bound to this held message
                </div>
              ),
            }
          : null
      }
      onRelease={noop}
      onCancel={noop}
      onEdit={() => setEditing(true)}
    />
  );
}

// ---- Timeline row fixtures ------------------------------------------------

function holdRow({
  detail = null,
  id,
  inputPreview = "Hello!",
  reason = "Scheduled · 3:10 PM",
  status = "pending",
  title = "Waiting to send",
}: {
  detail?: string | null;
  id: string;
  inputPreview?: string | null;
  reason?: string;
  status?: "pending" | "completed" | "interrupted";
  title?: string;
}): TimelineRow {
  return systemRow({
    id: `${THREAD_ID}:hold:${id}`,
    threadId: THREAD_ID,
    operationKind: "dispatch-hold",
    sourceSeqStart: 1,
    startedAt: NOW - 30_000,
    createdAt: NOW - 30_000,
    status,
    title,
    reason,
    inputPreview,
    detail,
  });
}

export function HeldDispatch() {
  return (
    <StoryCard labelWidth="220px">
      <StoryRow
        label="card · scheduled"
        hint="Edit / Send now / Cancel — editable inline holds get all three, on every thread including one whose first turn is the held one"
      >
        <ResponsiveStage>
          <InteractiveCard hold={scheduledHold} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="card · scheduled far out"
        hint="a send more than a day out shows the date, not just the clock"
      >
        <ResponsiveStage>
          <InteractiveCard hold={longMessageHold} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="card · retry, not user-releasable"
        hint="core owns the timer, so only Cancel is offered"
      >
        <ResponsiveStage>
          <InteractiveCard hold={retryHold} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="card · waiting on capacity"
        hint="no timer at all — it releases when a slot frees, so there is no time to show"
      >
        <ResponsiveStage>
          <InteractiveCard hold={capacityHold} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="card · host offline"
        hint="a core hold: only the host coming back releases it, so Cancel is the only action"
      >
        <ResponsiveStage>
          <InteractiveCard hold={hostOfflineHold} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="card · gone quiet"
        hint="past the staleness the holder declared, the card takes the attention surface"
      >
        <ResponsiveStage>
          <InteractiveCard hold={staleHold} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="card · cancelling"
        hint="every action on the thread is disabled while one runs"
      >
        <ResponsiveStage>
          <InteractiveCard
            hold={scheduledHold}
            actionDisabled
            pendingAction="cancel"
          />
        </ResponsiveStage>
      </StoryRow>

      <StoryRow
        label="timeline · waiting"
        hint="opens on its own: the reason rides the title, the body is the message that will be sent"
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="held"
            workspaceRootPath={undefined}
            timelineRows={[holdRow({ id: "waiting" })]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="timeline · waiting, with a report"
        hint="the holder's progress transcript sits under the message"
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="held"
            workspaceRootPath={undefined}
            timelineRows={[
              holdRow({
                id: "reporting",
                reason: "2 of 2 running on all hosts",
                detail: "waiting for a slot\n1 of 2 freed, still queued behind thr_a1b2",
              }),
            ]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="timeline · nothing to preview"
        hint="a retry references a turn already above it, so the row stays one line"
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="held"
            workspaceRootPath={undefined}
            timelineRows={[
              holdRow({
                id: "retry",
                reason: "Rate limited",
                inputPreview: null,
              }),
            ]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="timeline · settled"
        hint="sent and cancelled holds close again and recede into the past layer"
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
            timelineRows={[
              holdRow({
                id: "sent",
                status: "completed",
                title: "Sent",
                reason: "Scheduled · 3:10 PM",
              }),
              holdRow({
                id: "cancelled",
                status: "interrupted",
                title: "Send cancelled",
                reason: "Scheduled · 5:00 PM",
                inputPreview: "Ping the team about the migration",
              }),
            ]}
          />
        </TimelineStage>
      </StoryRow>

      <StoryRow
        label="wording · shipped"
        hint='"Waiting to send" / "Sent" / "Send cancelled" — pairs with the Send now button'
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="held"
            workspaceRootPath={undefined}
            timelineRows={[
              holdRow({ id: "w1-active", title: "Waiting to send" }),
              holdRow({
                id: "w1-sent",
                status: "completed",
                title: "Sent",
                inputPreview: null,
              }),
              holdRow({
                id: "w1-cancelled",
                status: "interrupted",
                title: "Send cancelled",
                inputPreview: null,
              }),
            ]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="wording · run-flavoured"
        hint='"Waiting to run" / "Started" / "Cancelled" — reads better for capacity and retry holds, worse for a scheduled send'
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="held"
            workspaceRootPath={undefined}
            timelineRows={[
              holdRow({ id: "w2-active", title: "Waiting to run" }),
              holdRow({
                id: "w2-sent",
                status: "completed",
                title: "Started",
                inputPreview: null,
              }),
              holdRow({
                id: "w2-cancelled",
                status: "interrupted",
                title: "Cancelled",
                inputPreview: null,
              }),
            ]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="wording · current (for reference)"
        hint="the internal vocabulary this change replaces"
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="held"
            workspaceRootPath={undefined}
            timelineRows={[
              holdRow({ id: "w0-active", title: "Dispatch held" }),
              holdRow({
                id: "w0-sent",
                status: "completed",
                title: "Dispatch released",
                inputPreview: null,
              }),
              holdRow({
                id: "w0-cancelled",
                status: "interrupted",
                title: "Dispatch cancelled",
                inputPreview: null,
              }),
            ]}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}
