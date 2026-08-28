import { type ReactNode } from "react";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { durationToCompactString } from "@bb/thread-view";
import {
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  PROMPT_STACK_ROW_CLASS,
  PromptBannerActionButton,
  PromptStackRowPendingLabel,
  PromptStackRowTextActions,
} from "@/components/promptbox/banner/prompt-banner-actions";
import { useSecondTick } from "@/hooks/useSecondTick";
import {
  isDispatchHoldEditable,
  isDispatchHoldStale,
} from "@/lib/dispatch-holds";
import { formatScheduledTime } from "@/lib/relative-time";

/** Which in-flight action a held card is running, for its button labels. */
export type HeldDispatchAction = "release" | "cancel";

/**
 * The open inline editor, owned by the composer above so a held message is
 * edited in the real composer — mentions, attachments, plugin actions and all
 * — exactly as a queued message or a sent message is.
 *
 * The card supplies its own chrome rather than wrapping this in
 * `InlineMessageEditorFrame`: a held row is one short line that already names
 * what is being edited and when it goes out, so the frame's "Editing …" header
 * would be a second bar restating it. The queue needs the frame because it
 * *replaces* a tall message row with the editor and would otherwise lose all
 * trace of which message is open.
 */
export interface HeldDispatchInlineEditor {
  content: ReactNode;
  holdId: string;
  onDismiss: () => void;
}

export interface HeldDispatchCardProps {
  hold: DispatchHoldResponse;
  /** True while any hold action on this thread is in flight. */
  actionDisabled: boolean;
  pendingAction: HeldDispatchAction | null;
  /** Rendered in place of the row when this hold is the one being edited. */
  inlineEditor: HeldDispatchInlineEditor | null;
  onRelease: (hold: DispatchHoldResponse) => void;
  onCancel: (hold: DispatchHoldResponse) => void;
  onEdit: (hold: DispatchHoldResponse) => void;
}

/**
 * What each action is called while it runs. The wording matches the button that
 * started it — "Send now" reports "Sending…", not "Releasing…" — because
 * "release" and "dispatch" name the mechanism rather than the thing the user
 * asked for.
 */
export const HELD_DISPATCH_ACTION_LABELS: Record<HeldDispatchAction, string> = {
  cancel: "Cancelling...",
  release: "Sending...",
};

export const HELD_DISPATCH_SEND_LABEL = "Send now";
export const HELD_DISPATCH_CANCEL_LABEL = "Cancel";
/**
 * Abandons the edit, not the send — which is why it cannot be called "Cancel"
 * next to a Cancel that calls off the message entirely.
 */
const HELD_DISPATCH_DISCARD_EDIT_LABEL = "Discard";

function heldDispatchScheduleLabel(
  hold: DispatchHoldResponse,
  now: number,
): string | null {
  if (hold.resumeAt === null) {
    return null;
  }
  return formatScheduledTime({ now, timestamp: hold.resumeAt });
}

/**
 * The status line of a held row: what the dispatch waits for, when it is
 * expected, and whether it has gone quiet. The clock glyph is what keeps it
 * visibly distinct from a queued message, which runs as soon as the thread
 * frees up.
 */
export function HeldDispatchSummary({
  children,
  reason,
  stale,
}: {
  /** Trailing detail spans — schedule, countdown, extra-hold count. */
  children: ReactNode;
  reason: string;
  stale: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <Icon
        name="Clock"
        className={cn(
          "size-3.5 shrink-0",
          stale ? "text-warning-text" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate text-foreground">{reason}</span>
      {children}
    </div>
  );
}

/**
 * The line a held row lays out: its summary, then its actions. The two share a
 * wrapping flex row rather than a fixed split so a narrow card drops the
 * actions onto their own line instead of truncating the countdown away — the
 * countdown is the reason the row exists.
 */
export function HeldDispatchRowLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-1.5 gap-y-1 py-1">
      {children}
    </div>
  );
}

/**
 * The summary half of {@link HeldDispatchRowLayout}. The basis is what makes
 * the row wrap rather than truncate: flex breaks a line on hypothetical sizes,
 * so declaring the summary's preferred width sends the actions to their own
 * line on a narrow card instead of squeezing "Scheduled · 3:10 PM · in 2m 49s"
 * down to an ellipsis.
 */
export const HELD_DISPATCH_SUMMARY_CLASS = "min-w-0 flex-1 basis-56";

/**
 * One held dispatch in the pending region, styled as a sibling of a queued
 * message row: same padding, same card surface. The clock glyph, the
 * waiting-for label and the named actions are what distinguish it, which is the
 * distinction that matters.
 */
export function HeldDispatchCard({
  hold,
  actionDisabled,
  pendingAction,
  inlineEditor,
  onRelease,
  onCancel,
  onEdit,
}: HeldDispatchCardProps) {
  const now = useSecondTick();
  const stale = isDispatchHoldStale(hold, now);
  const editing = inlineEditor !== null;
  const scheduleLabel = heldDispatchScheduleLabel(hold, now);
  const silentForMs = now - (hold.lastReportAt ?? hold.createdAt);
  const busy = pendingAction !== null;
  const showEditAction = isDispatchHoldEditable(hold) && !editing;

  return (
    <PromptStackCard
      ariaLabel={`Held dispatch: ${hold.reason}`}
      className={cn(
        "overflow-hidden",
        stale && "border-attention/50 bg-surface-attention",
      )}
    >
      <div
        className={PROMPT_STACK_ROW_CLASS}
        style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
      >
        <HeldDispatchRowLayout>
          <div className={HELD_DISPATCH_SUMMARY_CLASS}>
            <HeldDispatchSummary reason={hold.reason} stale={stale}>
              {scheduleLabel ? (
                <span className="shrink-0 text-muted-foreground">
                  · {scheduleLabel}
                </span>
              ) : null}
              {stale ? (
                <span className="shrink-0 text-warning-text">
                  · No update for {durationToCompactString(silentForMs)}
                </span>
              ) : null}
            </HeldDispatchSummary>
          </div>
          {inlineEditor !== null ? (
            <PromptStackRowTextActions label="Held dispatch actions">
              <PromptBannerActionButton
                aria-label="Stop editing held message"
                onClick={inlineEditor.onDismiss}
              >
                {HELD_DISPATCH_DISCARD_EDIT_LABEL}
              </PromptBannerActionButton>
            </PromptStackRowTextActions>
          ) : busy ? (
            <PromptStackRowPendingLabel>
              {HELD_DISPATCH_ACTION_LABELS[pendingAction]}
            </PromptStackRowPendingLabel>
          ) : (
            <PromptStackRowTextActions label="Held dispatch actions">
              {showEditAction ? (
                <PromptBannerActionButton
                  disabled={actionDisabled}
                  onClick={() => onEdit(hold)}
                >
                  Edit
                </PromptBannerActionButton>
              ) : null}
              {hold.userReleasable ? (
                <PromptBannerActionButton
                  disabled={actionDisabled}
                  onClick={() => onRelease(hold)}
                >
                  {HELD_DISPATCH_SEND_LABEL}
                </PromptBannerActionButton>
              ) : null}
              <PromptBannerActionButton
                disabled={actionDisabled}
                onClick={() => onCancel(hold)}
              >
                {HELD_DISPATCH_CANCEL_LABEL}
              </PromptBannerActionButton>
            </PromptStackRowTextActions>
          )}
        </HeldDispatchRowLayout>
      </div>
      {inlineEditor === null ? null : (
        <div className="relative z-20 px-2.5 pb-1.5">{inlineEditor.content}</div>
      )}
    </PromptStackCard>
  );
}
