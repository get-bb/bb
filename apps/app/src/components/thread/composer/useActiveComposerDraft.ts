import { useCallback, useMemo } from "react";
import {
  usePromptDraftController,
  usePromptDraftInputEmpty,
  type PromptDraftController,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import { promptDraftToInput } from "@bb/client-core";
import type { PromptDraftAttachment, PromptDraftState } from "@bb/client-core";
import type { PromptInput } from "@bb/domain";

export interface InlineComposerDraftSession {
  editSessionId: number;
  setDraft: (update: (current: PromptDraftState) => PromptDraftState) => void;
}

interface UseActiveComposerDraftArgs {
  draftScope: PromptDraftScope;
  inlineDraft: PromptDraftState | null;
  inlineSessionRef: React.RefObject<InlineComposerDraftSession | null>;
}

interface UseActiveComposerDraftResult {
  promptDraft: PromptDraftController;
  hasPromptDraftInput: boolean;
  inlineComposerDraftInput: PromptInput[];
  updateActiveComposerAttachments: (
    update: (attachments: PromptDraftAttachment[]) => PromptDraftAttachment[],
  ) => void;
}

const NO_INLINE_DRAFT_INPUT: PromptInput[] = [];

export function useActiveComposerDraft({
  draftScope,
  inlineDraft,
  inlineSessionRef,
}: UseActiveComposerDraftArgs): UseActiveComposerDraftResult {
  const promptDraft = usePromptDraftController(draftScope);
  const hasPromptDraftInput = !usePromptDraftInputEmpty(promptDraft);
  const updateStoredPromptAttachments = promptDraft.updateAttachments;
  const inlineComposerDraftInput = useMemo(
    () =>
      inlineDraft === null
        ? NO_INLINE_DRAFT_INPUT
        : promptDraftToInput(inlineDraft),
    [inlineDraft],
  );
  const updateActiveComposerAttachments = useCallback(
    (
      update: (attachments: PromptDraftAttachment[]) => PromptDraftAttachment[],
    ) => {
      const current = inlineSessionRef.current;
      if (current) {
        current.setDraft((draft) => ({
          ...draft,
          attachments: update(draft.attachments),
        }));
        return;
      }
      updateStoredPromptAttachments(update);
    },
    [inlineSessionRef, updateStoredPromptAttachments],
  );

  return {
    promptDraft,
    hasPromptDraftInput,
    inlineComposerDraftInput,
    updateActiveComposerAttachments,
  };
}
