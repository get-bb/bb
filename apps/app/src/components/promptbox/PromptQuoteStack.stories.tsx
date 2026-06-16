import { useCallback, useState } from "react";
import { PromptQuoteStack } from "@/components/promptbox/PromptQuoteStack";
import {
  addQuoteToDraft,
  emptyPromptDraftState,
  removeQuoteFromDraft,
  type PromptDraftState,
  type PromptQuote,
} from "@/lib/prompt-draft";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "promptbox/QuoteStack",
};

// Production max width matches PageShell's footer cap (760px).
function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const noop = () => {};

const SAMPLE_QUOTE_TEXTS: readonly string[] = [
  "We should debounce the search input before hitting the API.",
  "The env summary still renders the branch button on unmanaged environments — that should be hidden.",
  "Memoize per-message so a single token stream doesn't re-render every prior turn.\n\nThat's the long-thread jank from the design review.",
  "Confirm the timeline error overlay clears once the runtime reconnects.",
  "Audit prop names across the follow-up composer and trim the dead fields.",
  "The permission picker should render disabled (not hidden) in the side chat.",
  "Add a regression test for the empty-selection guard in addQuoteToDraft.",
  "Scroll-to-bottom button should only show while the runtime is actively streaming.",
  "Context banner first paint should be its final form — suppress until workspace status settles.",
  "Quotes must clear from the draft after a successful send so no stale pills linger.",
];

function makeQuotes(count: number): PromptQuote[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `quote_${index + 1}`,
    text:
      SAMPLE_QUOTE_TEXTS[index % SAMPLE_QUOTE_TEXTS.length] ??
      `Quote ${index + 1}`,
  }));
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="empty" hint="renders nothing — no chrome on a quote-less draft">
        <PromptStage>
          <PromptQuoteStack quotes={[]} onRemove={noop} />
        </PromptStage>
      </StoryRow>
      <StoryRow label="one" hint="single quote">
        <PromptStage>
          <PromptQuoteStack quotes={makeQuotes(1)} onRemove={noop} />
        </PromptStage>
      </StoryRow>
      <StoryRow label="two" hint="two stacked quotes">
        <PromptStage>
          <PromptQuoteStack quotes={makeQuotes(2)} onRemove={noop} />
        </PromptStage>
      </StoryRow>
      <StoryRow label="five" hint="five quotes — within the height cap">
        <PromptStage>
          <PromptQuoteStack quotes={makeQuotes(5)} onRemove={noop} />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="ten"
        hint="ten quotes — exceeds the height cap and scrolls"
      >
        <PromptStage>
          <PromptQuoteStack quotes={makeQuotes(10)} onRemove={noop} />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}

function InteractivePromptQuoteStack() {
  const [draft, setDraft] = useState<PromptDraftState>(() => {
    let next = emptyPromptDraftState();
    for (const text of SAMPLE_QUOTE_TEXTS.slice(0, 3)) {
      next = addQuoteToDraft(next, text);
    }
    return next;
  });

  const handleAdd = useCallback(() => {
    setDraft((current) => {
      const text =
        SAMPLE_QUOTE_TEXTS[current.quotes.length % SAMPLE_QUOTE_TEXTS.length] ??
        "Another quoted selection.";
      return addQuoteToDraft(current, text);
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setDraft((current) => removeQuoteFromDraft(current, id));
  }, []);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleAdd}
        className="rounded-md border border-border bg-surface-recessed px-2 py-1 text-xs text-foreground hover:bg-state-hover"
      >
        Add quote
      </button>
      <PromptQuoteStack quotes={draft.quotes} onRemove={handleRemove} />
    </div>
  );
}

export function Interactive() {
  return (
    <StoryCard>
      <StoryRow
        label="add / remove"
        hint="add quotes via addQuoteToDraft, remove via ✕ (removeQuoteFromDraft)"
      >
        <PromptStage>
          <InteractivePromptQuoteStack />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}
