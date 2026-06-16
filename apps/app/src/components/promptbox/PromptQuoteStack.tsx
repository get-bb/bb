import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  PromptQuotePill,
  type PromptQuotePillProps,
} from "@/components/promptbox/PromptQuotePill";
import type { PromptQuote } from "@/lib/prompt-draft";

export interface PromptQuoteStackProps {
  quotes: PromptQuote[];
  onRemove: PromptQuotePillProps["onRemove"];
}

/**
 * The stack of removable quote pills shown above the composer when the user has
 * pulled selected message text into the draft. Renders nothing when empty so it
 * adds no chrome to a quote-less draft. The list is height-capped and scrolls
 * once enough quotes accumulate, so a large pile of quotes never pushes the
 * composer off-screen.
 */
export function PromptQuoteStack({ quotes, onRemove }: PromptQuoteStackProps) {
  if (quotes.length === 0) {
    return null;
  }

  return (
    <PromptStackCard
      ariaLabel="Quoted selections"
      className="max-h-44 space-y-1.5 overflow-y-auto p-1.5"
    >
      {quotes.map((quote) => (
        <PromptQuotePill key={quote.id} quote={quote} onRemove={onRemove} />
      ))}
    </PromptStackCard>
  );
}
