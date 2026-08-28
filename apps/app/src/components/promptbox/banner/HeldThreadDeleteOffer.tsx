import type { Thread } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  PromptBannerActionButton,
  PromptBannerActionSlot,
} from "@/components/promptbox/banner/prompt-banner-actions";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";

const HELD_BANNER_EMPTY_THREAD_COPY = "Nothing left to run in this thread.";

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
