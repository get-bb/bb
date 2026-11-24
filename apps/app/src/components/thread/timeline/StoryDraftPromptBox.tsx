import { useCallback, useMemo, useState } from "react";
import {
  ComposerBox,
  type HistoryConfig,
} from "@/components/promptbox/ComposerBox";
import {
  createComposerDraftStore,
  type ComposerDraftStore,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import { emptyPromptDraftState } from "@bb/client-core";
import {
  makeAttachmentsConfig,
  makeTypeaheadConfig,
} from "../../../../.ladle/story-fixtures";

const noop = () => {};

const STORY_HISTORY: HistoryConfig = { entries: [], onSelectEntry: noop };

interface StoryPromptDraftController {
  store: ComposerDraftStore;
  focusEndKey: number;
  composerHost: PluginComposerHost;
}

export const STORY_THREAD_ID = "thr_story";

export function useStoryPromptDraft(
  threadId: string = STORY_THREAD_ID,
): StoryPromptDraftController {
  const [store] = useState(() =>
    createComposerDraftStore(emptyPromptDraftState()),
  );
  const [focusEndKey, setFocusEndKey] = useState(0);
  const focus = useCallback(() => {
    setFocusEndKey((current) => current + 1);
  }, []);
  const composerHost = useMemo<PluginComposerHost>(
    () => ({
      scope: {
        kind: "thread",
        threadId,
        projectId: "proj_story",
        environmentId: null,
      },
      textEffectKey: `story-draft:${threadId}`,
      getCurrent: store.getCurrent,
      subscribeDraft: store.subscribeDraft,
      setDraft: store.setDraft,
      focus,
    }),
    [focus, store, threadId],
  );

  return { store, focusEndKey, composerHost };
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
