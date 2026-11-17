import { useCallback, useMemo, useState } from "react";
import {
  ComposerBox,
  type HistoryConfig,
} from "@/components/promptbox/ComposerBox";
import {
  createComposerDraftStore,
  type ComposerDraftStore,
} from "@/components/plugin/plugin-composer-host";
import { appendQuoteToDraftText, emptyPromptDraftState } from "@bb/client-core";
import {
  makeAttachmentsConfig,
  makeTypeaheadConfig,
} from "../../../../.ladle/story-fixtures";

const noop = () => {};

const STORY_HISTORY: HistoryConfig = { entries: [], onSelectEntry: noop };

interface StoryPromptDraftController {
  store: ComposerDraftStore;
  focusEndKey: number;
  addQuote: (text: string) => void;
}

export function useStoryPromptDraft(): StoryPromptDraftController {
  const [store] = useState(() =>
    createComposerDraftStore(emptyPromptDraftState()),
  );
  const [focusEndKey, setFocusEndKey] = useState(0);

  const addQuote = useCallback(
    (quotedText: string) => {
      store.setDraft(appendQuoteToDraftText(store.getCurrent(), quotedText));
      setFocusEndKey((current) => current + 1);
    },
    [store],
  );

  return { store, focusEndKey, addQuote };
}

export function StoryDraftPromptBox({
  draft,
}: {
  draft: StoryPromptDraftController;
}) {
  const typeahead = useMemo(() => makeTypeaheadConfig(), []);
  const attachments = useMemo(() => makeAttachmentsConfig(), []);

  return (
    <ComposerBox
      draft={draft.store}
      onSubmit={noop}
      surface="thread"
      placeholder="Add to chat inserts a quote here"
      typeahead={typeahead}
      mentionMenuPlacement="bottom"
      attachments={attachments}
      history={STORY_HISTORY}
      focusEndKey={draft.focusEndKey}
    />
  );
}
