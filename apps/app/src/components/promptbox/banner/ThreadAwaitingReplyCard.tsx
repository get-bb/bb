import { useRef, type KeyboardEvent } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { cn } from "@bb/shared-ui/lib/utils";
import { PendingInteractionShell } from "@/components/thread/pending-interactions/PendingInteractionShell";

const REPLY_MIN_HEIGHT = 84;
const REPLY_MAX_HEIGHT = 158;

export interface AwaitingReplyCardVisibility {
  awaitingUserReply: boolean;
  hasAddressed: boolean;
  hasPendingInteraction: boolean;
  isComposerHidden: boolean;
  isThreadIdle: boolean;
}

/**
 * Whether to hand the composer's place to the decline/reply choice.
 *
 * A structured interaction already renders its own choices, and answering one
 * is how the user replies, so the card would be a second prompt for the same
 * turn. A thread that is running again has already been answered, even though
 * the flag stays set until that turn ends. With no composer to take the place
 * of, there is nowhere to put the card.
 */
export function shouldShowAwaitingReplyCard(
  state: AwaitingReplyCardVisibility,
): boolean {
  return (
    state.awaitingUserReply &&
    state.isThreadIdle &&
    !state.hasPendingInteraction &&
    !state.isComposerHidden &&
    !state.hasAddressed
  );
}

interface AwaitingReplyChoiceRowProps {
  description: string;
  disabled: boolean;
  label: string;
  onSelect: () => void;
}

function AwaitingReplyChoiceRow({
  description,
  disabled,
  label,
  onSelect,
}: AwaitingReplyChoiceRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
        "hover:bg-state-hover disabled:cursor-not-allowed disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input text-muted-foreground">
        <Icon name="X" className="size-2.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

interface ThreadAwaitingReplyCardProps {
  draftText: string;
  isDismissPending: boolean;
  isSendDisabled: boolean;
  onDeclineFollowUp: () => void;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  onUseComposer: () => void;
}

export function ThreadAwaitingReplyCard({
  draftText,
  isDismissPending,
  isSendDisabled,
  onDeclineFollowUp,
  onDraftChange,
  onSend,
  onUseComposer,
}: ThreadAwaitingReplyCardProps) {
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const isPointerCoarse = usePointerCoarse();
  const canSend = draftText.trim().length > 0 && !isSendDisabled;
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  };

  return (
    <PendingInteractionShell
      label="Waiting on your reply"
      expandedByDefault
      testId="awaiting-reply-banner"
    >
      {() => (
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            The agent ended its turn with a question.
          </div>
          <div className="mt-2 space-y-0.5">
            <AwaitingReplyChoiceRow
              description="Stop this thread waiting on you, without replying"
              disabled={isDismissPending}
              label="Decline follow up"
              onSelect={onDeclineFollowUp}
            />
          </div>
          <textarea
            ref={replyRef}
            aria-label="Reply to the agent's question"
            value={draftText}
            rows={1}
            autoFocus={!isPointerCoarse}
            autoComplete="off"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Reply…"
            className="mt-2 w-full resize-none overflow-y-auto rounded-md border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
            style={{
              minHeight: `${REPLY_MIN_HEIGHT}px`,
              maxHeight: `${REPLY_MAX_HEIGHT}px`,
            }}
          />
          <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onUseComposer}
            >
              Reply in composer
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSend}
              onClick={onSend}
            >
              Send reply
            </Button>
          </div>
        </div>
      )}
    </PendingInteractionShell>
  );
}
