import { useState } from "react";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { queuedInputToDraft } from "@bb/client-core";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { durationToCompactString } from "@bb/thread-view";
import {
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  PromptBannerActionButton,
  PromptBannerActionSlot,
} from "@/components/promptbox/banner/prompt-banner-actions";
import { useSecondTick } from "@/hooks/useSecondTick";
import {
  dispatchHoldExpectedDispatchAt,
  isDispatchHoldEditable,
  isDispatchHoldStale,
} from "@/lib/dispatch-holds";
import { formatScheduledTime } from "@/lib/relative-time";

/** Which in-flight action a held card is running, for its button labels. */
export type HeldDispatchAction = "release" | "cancel" | "save";

export interface HeldDispatchCardProps {
  hold: DispatchHoldResponse;
  /** True while any hold action on this thread is in flight. */
  actionDisabled: boolean;
  pendingAction: HeldDispatchAction | null;
  onRelease: (hold: DispatchHoldResponse) => void;
  onCancel: (hold: DispatchHoldResponse) => void;
  onSaveInput: (hold: DispatchHoldResponse, text: string) => void;
}

const HELD_DISPATCH_ACTION_LABELS: Record<HeldDispatchAction, string> = {
  cancel: "Cancelling...",
  release: "Releasing...",
  save: "Saving...",
};

/**
 * The live remainder until a hold's expected dispatch. Isolated so the ticking
 * clock re-renders one span rather than the whole pending region.
 */
function HeldDispatchCountdown({ target }: { target: number }) {
  const remainingMs = target - useSecondTick();
  if (remainingMs <= 0) {
    return null;
  }
  return (
    <span className="shrink-0 tabular-nums text-muted-foreground">
      in {durationToCompactString(remainingMs)}
    </span>
  );
}

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
 * One held dispatch in the pending region. Visibly distinct from a queued
 * message — a clock glyph, what the dispatch is waiting for, and when it is
 * expected — because a queued message runs as soon as the thread frees up and
 * a held one does not.
 */
export function HeldDispatchCard({
  hold,
  actionDisabled,
  pendingAction,
  onRelease,
  onCancel,
  onSaveInput,
}: HeldDispatchCardProps) {
  const now = useSecondTick();
  const [editingText, setEditingText] = useState<string | null>(null);
  const stale = isDispatchHoldStale(hold, now);
  const editable = isDispatchHoldEditable(hold);
  const scheduleLabel = heldDispatchScheduleLabel(hold, now);
  const expectedDispatchAt = dispatchHoldExpectedDispatchAt(hold);
  const showCountdown =
    hold.resumeAt !== null || hold.expectedReleaseAt !== null;
  const silentForMs = now - (hold.lastReportAt ?? hold.createdAt);
  const busy = pendingAction !== null;

  return (
    <PromptStackCard
      ariaLabel={`Held dispatch: ${hold.reason}`}
      className={cn(
        "overflow-hidden",
        stale && "border-attention/50 bg-surface-attention",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-0.5 text-xs",
          PROMPT_STACK_INLAY_INSET_CLASS,
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            PROMPT_STACK_INLAY_SEGMENT_CLASS,
          )}
        >
          <Icon
            name="Clock"
            className={cn(
              "size-3.5 shrink-0",
              stale ? "text-warning-text" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-foreground">
            {hold.reason}
          </span>
          {scheduleLabel ? (
            <span className="shrink-0 text-muted-foreground">
              · {scheduleLabel}
            </span>
          ) : null}
          {showCountdown ? (
            <HeldDispatchCountdown target={expectedDispatchAt} />
          ) : null}
          {stale ? (
            <span className="shrink-0 text-warning-text">
              No update for {durationToCompactString(silentForMs)}
            </span>
          ) : null}
        </div>
        <PromptBannerActionSlot>
          {busy ? (
            <span className="whitespace-nowrap px-1">
              {HELD_DISPATCH_ACTION_LABELS[pendingAction]}
            </span>
          ) : (
            <>
              {editable && editingText === null ? (
                <PromptBannerActionButton
                  disabled={actionDisabled}
                  onClick={() =>
                    setEditingText(
                      hold.payload.kind === "inline"
                        ? queuedInputToDraft(hold.payload.input).text
                        : "",
                    )
                  }
                >
                  Edit
                </PromptBannerActionButton>
              ) : null}
              {hold.userReleasable ? (
                <PromptBannerActionButton
                  disabled={actionDisabled}
                  onClick={() => onRelease(hold)}
                >
                  Release now
                </PromptBannerActionButton>
              ) : null}
              <PromptBannerActionButton
                disabled={actionDisabled}
                onClick={() => onCancel(hold)}
              >
                Cancel
              </PromptBannerActionButton>
            </>
          )}
        </PromptBannerActionSlot>
      </div>
      {editingText === null ? null : (
        <div className="flex flex-col gap-1.5 border-t border-border/35 px-2 py-2">
          <textarea
            aria-label="Edit held message"
            className="min-h-16 w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={editingText}
            onChange={(event) => setEditingText(event.target.value)}
          />
          <div className="flex items-center justify-end gap-1.5">
            <PromptBannerActionButton onClick={() => setEditingText(null)}>
              Discard changes
            </PromptBannerActionButton>
            <PromptBannerActionButton
              disabled={actionDisabled || editingText.trim().length === 0}
              onClick={() => {
                onSaveInput(hold, editingText);
                setEditingText(null);
              }}
            >
              Save
            </PromptBannerActionButton>
          </div>
        </div>
      )}
    </PromptStackCard>
  );
}
