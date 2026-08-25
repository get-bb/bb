import type { Thread } from "@bb/domain";
import type { DispatchHoldResponse } from "@bb/server-contract";
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
import type { HeldDispatchAction } from "@/components/promptbox/banner/HeldDispatchCard";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { useSecondTick } from "@/hooks/useSecondTick";
import {
  dispatchHoldExpectedDispatchAt,
  isDispatchHoldStale,
} from "@/lib/dispatch-holds";
import { formatScheduledTime } from "@/lib/relative-time";

export interface ThreadHeldBannerProps {
  /** The thread's soonest live hold — the one blocking its first turn. */
  hold: DispatchHoldResponse;
  /** Live holds beyond `hold`, so the banner can say the count. */
  additionalHoldCount: number;
  actionDisabled: boolean;
  pendingAction: HeldDispatchAction | null;
  onRelease: (hold: DispatchHoldResponse) => void;
  onCancel: (hold: DispatchHoldResponse) => void;
}

const HELD_BANNER_ACTION_LABELS: Record<HeldDispatchAction, string> = {
  cancel: "Cancelling...",
  release: "Releasing...",
  save: "Saving...",
};

const HELD_BANNER_EMPTY_THREAD_COPY = "Nothing left to run in this thread.";

/**
 * Explains a thread that has never started because its first turn is held.
 * Deliberately simple: the reason, when it is expected to run, and the two
 * actions. The hold's progress transcript lives on its timeline row, which is
 * where a reader looks for detail.
 */
export function ThreadHeldBanner({
  hold,
  additionalHoldCount,
  actionDisabled,
  pendingAction,
  onRelease,
  onCancel,
}: ThreadHeldBannerProps) {
  const now = useSecondTick();
  const stale = isDispatchHoldStale(hold, now);
  const scheduleLabel =
    hold.resumeAt === null
      ? null
      : formatScheduledTime({ now, timestamp: hold.resumeAt });
  const remainingMs = dispatchHoldExpectedDispatchAt(hold) - now;
  const showCountdown =
    (hold.resumeAt !== null || hold.expectedReleaseAt !== null) &&
    remainingMs > 0;
  const silentForMs = now - (hold.lastReportAt ?? hold.createdAt);

  return (
    <PromptStackCard
      ariaLabel="Thread held"
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
          role="status"
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
            <span className="shrink-0 tabular-nums text-muted-foreground">
              in {durationToCompactString(remainingMs)}
            </span>
          ) : null}
          {stale ? (
            <span className="shrink-0 text-warning-text">
              No update for {durationToCompactString(silentForMs)}
            </span>
          ) : null}
          {additionalHoldCount > 0 ? (
            <span className="shrink-0 text-muted-foreground">
              +{additionalHoldCount} more held
            </span>
          ) : null}
        </div>
        <PromptBannerActionSlot>
          {pendingAction === null ? (
            <>
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
          ) : (
            <span className="whitespace-nowrap px-1">
              {HELD_BANNER_ACTION_LABELS[pendingAction]}
            </span>
          )}
        </PromptBannerActionSlot>
      </div>
    </PromptStackCard>
  );
}

export interface HeldThreadDeleteOfferProps {
  thread: Thread;
  onDismiss: () => void;
}

/**
 * Cancelling the only hold of a never-started thread leaves an empty shell.
 * This is the lightweight, dismissible offer to clean it up — deletion itself
 * still runs through the app's normal confirm flow, because it is the one
 * action here that cannot be undone.
 */
export function HeldThreadDeleteOffer({
  thread,
  onDismiss,
}: HeldThreadDeleteOfferProps) {
  const { requestDelete } = useThreadActions();

  return (
    <PromptStackCard ariaLabel="Empty thread" className="overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          PROMPT_STACK_INLAY_INSET_CLASS,
        )}
      >
        <span className={cn("min-w-0 truncate", PROMPT_STACK_INLAY_SEGMENT_CLASS)}>
          {HELD_BANNER_EMPTY_THREAD_COPY}
        </span>
        <PromptBannerActionSlot>
          <PromptBannerActionButton
            onClick={() => {
              requestDelete(thread);
              onDismiss();
            }}
          >
            Delete thread
          </PromptBannerActionButton>
          <PromptBannerActionButton onClick={onDismiss}>Keep</PromptBannerActionButton>
        </PromptBannerActionSlot>
      </div>
    </PromptStackCard>
  );
}
