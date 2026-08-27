import { useState, type ReactNode } from "react";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { queuedInputToDraft } from "@bb/client-core";
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
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  PROMPT_STACK_ROW_CLASS,
  PROMPT_STACK_ROW_OVERFLOW_TRIGGER_CLASS,
  PromptBannerActionButton,
  PromptStackRowActionButton,
  PromptStackRowActions,
  PromptStackRowPendingLabel,
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
 * One held dispatch in the pending region, styled as a sibling of a queued
 * message row: same padding, same hover-revealed glyph actions, same overflow
 * menu below `md`. Only the clock glyph and the waiting-for label distinguish
 * it, which is the distinction that matters.
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
  const startEditing = () => {
    setEditingText(
      hold.payload.kind === "inline"
        ? queuedInputToDraft(hold.payload.input).text
        : "",
    );
  };
  const showEditAction = editable && editingText === null;

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
        <div className="flex min-h-7 items-center gap-1.5">
          <div className="min-w-0 flex-1 py-1">
            <HeldDispatchSummary reason={hold.reason} stale={stale}>
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
            </HeldDispatchSummary>
          </div>
          {busy ? (
            <PromptStackRowPendingLabel>
              {HELD_DISPATCH_ACTION_LABELS[pendingAction]}
            </PromptStackRowPendingLabel>
          ) : (
            <>
              <PromptStackRowActions label="Held dispatch actions">
                {showEditAction ? (
                  <PromptStackRowActionButton
                    icon="Edit"
                    label="Edit held message"
                    disabled={actionDisabled}
                    onClick={startEditing}
                  />
                ) : null}
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
                    aria-label="Held dispatch actions"
                  >
                    <Icon
                      name="MoreHorizontal"
                      className="size-4"
                      aria-hidden
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[7rem]">
                  {showEditAction ? (
                    <DropdownMenuItem onSelect={startEditing}>
                      <Icon name="Edit" aria-hidden />
                      Edit
                    </DropdownMenuItem>
                  ) : null}
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
          )}
        </div>
      </div>
      {editingText === null ? null : (
        <div className="flex flex-col gap-1.5 border-t border-border/35 px-2.5 py-2">
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
