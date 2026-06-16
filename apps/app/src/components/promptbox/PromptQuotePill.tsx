import { Icon } from "@/components/ui/icon.js";
import type { PromptQuote } from "@/lib/prompt-draft";

export interface PromptQuotePillProps {
  quote: PromptQuote;
  onRemove: (id: string) => void;
}

/**
 * A single removable quote row rendered inside the quote-stack card above the
 * composer. The surrounding `PromptStackCard` owns the recessed/bordered chrome
 * (like the queued-messages rows do), so the row itself is borderless and adds
 * only a left accent bar marking it as pulled-in context. The quote text wraps
 * and clamps to two lines; the ✕ removes this quote from the draft.
 */
export function PromptQuotePill({ quote, onRemove }: PromptQuotePillProps) {
  return (
    <div className="flex items-start gap-2 overflow-hidden pr-1.5">
      <div
        aria-hidden
        className="w-0.5 shrink-0 self-stretch rounded-l bg-surface-selected-border"
      />
      <Icon
        name="MessageSquarePlus"
        className="mt-1.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <p className="min-w-0 flex-1 break-words whitespace-pre-wrap py-1 text-xs leading-4 text-foreground line-clamp-2">
        {quote.text}
      </p>
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
