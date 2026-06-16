import { Icon } from "@/components/ui/icon.js";
import type { PromptQuote } from "@/lib/prompt-draft";

export interface PromptQuotePillProps {
  quote: PromptQuote;
  onRemove: (id: string) => void;
  /**
   * Scroll the timeline to the agent message this quote came from. When
   * supplied and the quote has a `sourceMessageId`, the quote becomes a button
   * that jumps to its source on click.
   */
  onJumpToSource?: (sourceMessageId: string) => void;
}

/**
 * A single removable quote row rendered inside the quote-stack card above the
 * composer. The surrounding `PromptStackCard` owns the recessed/bordered chrome
 * (like the queued-messages rows do), so the row itself is borderless and adds
 * only a left accent bar marking it as pulled-in context. The quote text wraps
 * and clamps to two lines; the ✕ removes this quote from the draft.
 */
export function PromptQuotePill({
  quote,
  onRemove,
  onJumpToSource,
}: PromptQuotePillProps) {
  const sourceMessageId = quote.sourceMessageId;
  const canJump = sourceMessageId !== undefined && onJumpToSource !== undefined;

  const content = (
    <>
      <Icon
        name="MessageSquarePlus"
        className="mt-1.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <p className="min-w-0 flex-1 break-words whitespace-pre-wrap py-1 text-xs leading-4 text-foreground line-clamp-2">
        {quote.text}
      </p>
    </>
  );

  return (
    <div className="flex items-start gap-2 overflow-hidden pr-1.5">
      <div
        aria-hidden
        className="w-0.5 shrink-0 self-stretch rounded-l bg-surface-selected-border"
      />
      {canJump ? (
        <button
          type="button"
          onClick={() => onJumpToSource(sourceMessageId)}
          title="Jump to source message"
          className="flex min-w-0 flex-1 items-start gap-2 rounded text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2">{content}</div>
      )}
      <button
        type="button"
        onClick={() => onRemove(quote.id)}
        aria-label="Remove quote"
        className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        <Icon name="X" className="size-3" />
      </button>
    </div>
  );
}
