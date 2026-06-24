import type { PromptTextMention } from "@bb/domain";
import { useCallback, useMemo, useState } from "react";
import {
  PromptBoxInternal,
  type HistoryConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { appendQuoteToDraftText } from "@/lib/prompt-draft";
import {
  makeAttachmentsConfig,
  makeTypeaheadConfig,
} from "../../../../.ladle/story-fixtures";

const noop = () => {};

interface StoryPromptDraft {
  text: string;
  mentionRanges: PromptTextMention[];
}

export interface StoryPromptDraftController extends StoryPromptDraft {
  focusEndKey: number;
  addQuote: (text: string) => void;
  onChange: (text: string, mentionRanges: PromptTextMention[]) => void;
}

export function useStoryPromptDraft(): StoryPromptDraftController {
  const [draft, setDraft] = useState<StoryPromptDraft>({
    text: "",
    mentionRanges: [],
  });
  const [focusEndKey, setFocusEndKey] = useState(0);

  const addQuote = useCallback((quotedText: string) => {
    setDraft((current) => {
      const next = appendQuoteToDraftText(
        {
          text: current.text,
          mentions: current.mentionRanges,
          attachments: [],
        },
        quotedText,
      );
      return {
        text: next.text,
        mentionRanges: next.mentions,
      };
    });
    setFocusEndKey((current) => current + 1);
  }, []);

  const onChange = useCallback(
    (text: string, mentionRanges: PromptTextMention[]) => {
      setDraft({ text, mentionRanges });
    },
    [],
  );

  return {
    ...draft,
    focusEndKey,
    addQuote,
    onChange,
  };
}

export function StoryDraftPromptBox({
  draft,
}: {
  draft: StoryPromptDraftController;
}) {
  const typeahead = useMemo(() => makeTypeaheadConfig(), []);
  const attachments = useMemo(() => makeAttachmentsConfig(), []);
  const history = useMemo<HistoryConfig>(
    () => ({
      currentDraft: {
        text: draft.text,
        mentions: draft.mentionRanges,
        attachments: [],
      },
      entries: [],
      onSelectEntry: noop,
    }),
    [draft.mentionRanges, draft.text],
  );

  return (
    <PromptBoxInternal
      value={draft.text}
      mentionRanges={draft.mentionRanges}
      onChange={draft.onChange}
      onSubmit={noop}
      placeholder="Add to chat inserts a quote here"
      typeahead={typeahead}
      mentionMenuPlacement="bottom"
      attachments={attachments}
      history={history}
      focusEndKey={draft.focusEndKey}
    />
  );
}
