import { useState } from "react";
import { PromptQuotePill } from "@/components/promptbox/PromptQuotePill";
import type { PromptQuote } from "@/lib/prompt-draft";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "promptbox/QuotePill",
};

// Production max width matches PageShell's footer cap (760px) so the pill wraps
// the way it does above the real composer.
function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const noop = () => {};

const shortQuote: PromptQuote = {
  id: "quote_short",
  text: "We should debounce the search input before hitting the API.",
};

const longQuote: PromptQuote = {
  id: "quote_long",
  text: "The timeline projection rebuilds the entire message list on every realtime event, which means a single token stream re-renders all prior turns.\n\nWe should memoize per-message and only re-render the streaming tail. That alone should cut the long-thread jank we saw in the design review.",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="short" hint="single-line selection fits without clamping">
        <PromptStage>
          <PromptQuotePill quote={shortQuote} onRemove={noop} />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="truncation"
        hint="long multi-paragraph selection clamps to two lines"
      >
        <PromptStage>
          <PromptQuotePill quote={longQuote} onRemove={noop} />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="jump to source"
        hint="quote with a sourceMessageId becomes a button (hover underlines); click logs the id"
      >
        <PromptStage>
          <PromptQuotePill
            quote={{ ...shortQuote, sourceMessageId: "row-42" }}
            onRemove={noop}
            onJumpToSource={(id) => console.log("jump to", id)}
          />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}

function RemovablePromptQuotePill() {
  const [quote, setQuote] = useState<PromptQuote | null>(shortQuote);
  if (!quote) {
    return (
      <p className="text-xs text-muted-foreground">
        Quote removed. Reload the story to restore it.
      </p>
    );
  }
  return (
    <PromptQuotePill quote={quote} onRemove={() => setQuote(null)} />
  );
}

export function Removable() {
  return (
    <StoryCard>
      <StoryRow label="removable" hint="✕ removes the pill">
        <PromptStage>
          <RemovablePromptQuotePill />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}
