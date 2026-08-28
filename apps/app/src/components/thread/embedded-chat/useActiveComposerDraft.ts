import { useCallback, useMemo } from "react";
import type { PromptTextMention } from "@bb/domain";
import {
  usePromptDraftStorage,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import { promptDraftToInput } from "@bb/client-core";
import type { PromptDraftState } from "@bb/client-core";
import type { PromptInput } from "@bb/domain";
import type { InlineQueuedMessageEditState } from "./useInlineQueuedMessageEditing";

interface UseActiveComposerDraftArgs {
  draftScope: PromptDraftScope;
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null;
  inlineEditingQueuedMessageRef: React.RefObject<InlineQueuedMessageEditState | null>;
  commitInlineQueuedMessage: (
    next: InlineQueuedMessageEditState | null,
  ) => void;
}

interface UseActiveComposerDraftResult {
  promptDraft: ReturnType<typeof usePromptDraftStorage>;
  currentPromptDraft: PromptDraftState;
  currentPromptDraftInput: PromptInput[];
  activeComposerDraft: PromptDraftState;
  activeComposerDraftInput: PromptInput[];
  setActiveComposerDraft: (draft: PromptDraftState) => void;
  handleChangeMessage: (text: string, mentions: PromptTextMention[]) => void;
  removeActiveComposerAttachment: (path: string) => void;
}

export function useActiveComposerDraft({
  draftScope,
  inlineEditingQueuedMessage,
  inlineEditingQueuedMessageRef,
  commitInlineQueuedMessage,
}: UseActiveComposerDraftArgs): UseActiveComposerDraftResult {
  const promptDraft = usePromptDraftStorage(draftScope);
  const setStoredPromptDraft = promptDraft.setDraft;
  const setStoredPromptTextAndMentions = promptDraft.setTextAndMentions;
  const removeStoredPromptAttachment = promptDraft.removeAttachment;

  const currentPromptDraft = useMemo(
    () => ({
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const currentPromptDraftInput = useMemo(
    () => promptDraftToInput(currentPromptDraft),
    [currentPromptDraft],
  );
  const activeComposerDraft =
    inlineEditingQueuedMessage?.draft ?? currentPromptDraft;
  const activeComposerDraftInput = useMemo(
    () => promptDraftToInput(activeComposerDraft),
    [activeComposerDraft],
  );

  const setActiveComposerDraft = useCallback(
    (draft: PromptDraftState) => {
      const current = inlineEditingQueuedMessageRef.current;
      if (current) {
        commitInlineQueuedMessage({ ...current, draft });
        return;
      }
      setStoredPromptDraft(draft);
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessageRef,
      setStoredPromptDraft,
    ],
  );
  const handleChangeMessage = useCallback(
    (text: string, mentions: PromptTextMention[]) => {
      const current = inlineEditingQueuedMessageRef.current;
      if (current) {
        commitInlineQueuedMessage({
          ...current,
          draft: { ...current.draft, mentions, text },
        });
        return;
      }
      setStoredPromptTextAndMentions(text, mentions);
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessageRef,
      setStoredPromptTextAndMentions,
    ],
  );
  const removeActiveComposerAttachment = useCallback(
    (path: string) => {
      const current = inlineEditingQueuedMessageRef.current;
      if (current) {
        commitInlineQueuedMessage({
          ...current,
          draft: {
            ...current.draft,
            attachments: current.draft.attachments.filter(
              (attachment) => attachment.path !== path,
            ),
          },
        });
        return;
      }
      removeStoredPromptAttachment(path);
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessageRef,
      removeStoredPromptAttachment,
    ],
  );

  return {
    promptDraft,
    currentPromptDraft,
    currentPromptDraftInput,
    activeComposerDraft,
    activeComposerDraftInput,
    setActiveComposerDraft,
    handleChangeMessage,
    removeActiveComposerAttachment,
  };
}
