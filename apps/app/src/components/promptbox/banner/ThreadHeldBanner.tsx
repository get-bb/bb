import type { Thread } from "@bb/domain";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { durationToCompactString } from "@bb/thread-view";
import {
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  PROMPT_STACK_ROW_CLASS,
  PROMPT_STACK_ROW_OVERFLOW_TRIGGER_CLASS,
  PromptBannerActionButton,
  PromptBannerActionSlot,
  PromptStackRowActionButton,
  PromptStackRowActions,
  PromptStackRowPendingLabel,
} from "@/components/promptbox/banner/prompt-banner-actions";
import {
  HeldDispatchSummary,
  type HeldDispatchAction,
} from "@/components/promptbox/banner/HeldDispatchCard";
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
        className={PROMPT_STACK_ROW_CLASS}
        style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
      >
        <div className="flex min-h-7 items-center gap-1.5">
          <div className="min-w-0 flex-1 py-1" role="status">
            <HeldDispatchSummary reason={hold.reason} stale={stale}>
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
            </HeldDispatchSummary>
          </div>
          {pendingAction === null ? (
            <>
              <PromptStackRowActions label="Held thread actions">
                {hold.userReleasable ? (
                  <PromptStackRowActionButton
                    icon="Play"
                    label="Release now"
                    disabled={actionDisabled}
                    onClick={() => onRelease(hold)}
                  />
                ) : null}
                <PromptStackRowActionButton
                  icon="X"
                  label="Cancel held dispatch"
                  destructive
                  disabled={actionDisabled}
                  onClick={() => onCancel(hold)}
                />
              </PromptStackRowActions>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={PROMPT_STACK_ROW_OVERFLOW_TRIGGER_CLASS}
                    disabled={actionDisabled}
                    aria-label="Held thread actions"
                  >
                    <Icon
                      name="MoreHorizontal"
                      className="size-4"
                      aria-hidden
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[7rem]">
                  {hold.userReleasable ? (
                    <DropdownMenuItem onSelect={() => onRelease(hold)}>
                      <Icon name="Play" aria-hidden />
                      Release now
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onCancel(hold)}
                  >
                    <Icon name="X" aria-hidden />
                    Cancel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <PromptStackRowPendingLabel>
              {HELD_BANNER_ACTION_LABELS[pendingAction]}
            </PromptStackRowPendingLabel>
          )}
        </div>
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
