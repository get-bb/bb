import { useCallback, useMemo, useState } from "react";
import type { PromptInput } from "@bb/domain";
import { PromptQuoteStack } from "@/components/promptbox/PromptQuoteStack";
import {
  addQuoteToDraft,
  emptyPromptDraftState,
  promptDraftToInput,
  removeQuoteFromDraft,
  type PromptDraftState,
} from "@/lib/prompt-draft";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "promptbox/QuoteIntegration",
};

// Production max width matches PageShell's footer cap (760px), so the composer
// preview here mirrors the real follow-up composer's quote-stack + textarea
// stacking from ThreadDetailPromptArea.
function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

// Selections an agent message would yield via the timeline "Add to chat" action.
const SAMPLE_SELECTION_TEXTS: readonly string[] = [
  "Debounce the search input before hitting the API.",
  "Hide the branch button on unmanaged environments.\n\nIt renders today even when there's no branch to act on.",
  "Clear quotes from the draft after a successful send.",
];

const USER_TEXT = "Can you handle these follow-ups in order?";

/**
 * Mirrors the composer surface from `ThreadDetailPromptArea`: the
 * `PromptQuoteStack` sits directly above the text input, both reading from one
 * draft. "Add to chat" pushes a quote via `addQuoteToDraft` (the exact path the
 * timeline selection menu drives through `usePromptDraftStorage.addQuote`); the
 * ✕ on each chip removes it via `removeQuoteFromDraft`.
 */
function ComposerWithQuotes() {
  const [draft, setDraft] = useState<PromptDraftState>(() => {
    let next = emptyPromptDraftState();
    for (const text of SAMPLE_SELECTION_TEXTS.slice(0, 2)) {
      next = addQuoteToDraft(next, text);
    }
    return { ...next, text: USER_TEXT };
  });

  const handleAddToChat = useCallback(() => {
    setDraft((current) => {
      const text =
        SAMPLE_SELECTION_TEXTS[
          current.quotes.length % SAMPLE_SELECTION_TEXTS.length
        ] ?? "Another quoted selection.";
      return addQuoteToDraft(current, text);
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setDraft((current) => removeQuoteFromDraft(current, id));
  }, []);

  // The exact outgoing shape on submit: a leading quote text part (when any
  // quotes exist) followed by the unchanged user-text part.
  const outgoing = useMemo<PromptInput[]>(
    () => promptDraftToInput(draft),
    [draft],
  );

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleAddToChat}
        className="rounded-md border border-border bg-surface-recessed px-2 py-1 text-xs text-foreground hover:bg-state-hover"
      >
        Add to chat
      </button>

      {/* Composer surface: quote stack above the text input (real stacking). */}
      <div className="rounded-lg border border-border bg-card p-2">
        <PromptQuoteStack quotes={draft.quotes} onRemove={handleRemove} />
        <textarea
          value={draft.text}
          onChange={(event) =>
            setDraft((current) => ({ ...current, text: event.target.value }))
          }
          rows={2}
          className="mt-2 w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none"
          aria-label="Message"
        />
      </div>

      {/* Serialized submit preview via promptDraftToInput. */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          Outgoing PromptInput[] (promptDraftToInput)
        </p>
        <pre className="overflow-auto rounded-md border border-border bg-surface-recessed p-2 font-mono text-xs leading-tight text-foreground">
          {JSON.stringify(outgoing, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="add to chat → submit"
        hint="quote chip appears in the composer's PromptQuoteStack; submit flattens to a leading quote part + unchanged user-text part"
      >
        <PromptStage>
          <ComposerWithQuotes />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}
