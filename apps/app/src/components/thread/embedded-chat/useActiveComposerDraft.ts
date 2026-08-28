import { useCallback, useMemo } from "react";
import type { PromptTextMention } from "@bb/domain";
import {
  usePromptDraftStorage,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import { promptDraftToInput } from "@bb/client-core";
import type { PromptDraftState } from "@bb/client-core";
import type { PromptInput } from "@bb/domain";

/**
 * The write side of whichever inline editor currently owns typing — a queued
 * message or a held dispatch. This is the whole shared seam: everything else
 * about the two sessions (identity, conflict guard, frozen execution tuple)
 * belongs to their own hooks and never reaches the composer draft layer.
 *
 * `setDraft` takes an updater rather than a value, and each session applies it
 * against its own synchronously-maintained ref. That is what lets plugin
 * composer actions read and write back-to-back inside one event: React batches
 * state, so a value-taking setter would let the second action overwrite the
 * first with a draft it read before it landed.
 */
export interface InlineComposerDraftSession {
  editSessionId: number;
  setDraft: (update: (current: PromptDraftState) => PromptDraftState) => void;
}

interface UseActiveComposerDraftArgs {
  draftScope: PromptDraftScope;
  /** The open inline editor's draft, for display. Null = bottom composer. */
  inlineDraft: PromptDraftState | null;
  inlineSessionRef: React.RefObject<InlineComposerDraftSession | null>;
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

/**
 * Exposes the persisted bottom draft plus an active draft view for whichever
 * inline editor is open and the currently published plugin host. Active writes
 * route through the inline-session ref so back-to-back plugin composer actions
 * in one event observe each other's updates.
 */
export function useActiveComposerDraft({
  draftScope,
  inlineDraft,
  inlineSessionRef,
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
  const activeComposerDraft = inlineDraft ?? currentPromptDraft;
  const activeComposerDraftInput = useMemo(
    () => promptDraftToInput(activeComposerDraft),
    [activeComposerDraft],
  );

  const setActiveComposerDraft = useCallback(
    (draft: PromptDraftState) => {
      const current = inlineSessionRef.current;
      if (current) {
        current.setDraft(() => draft);
        return;
      }
      setStoredPromptDraft(draft);
    },
    [inlineSessionRef, setStoredPromptDraft],
  );
  const handleChangeMessage = useCallback(
    (text: string, mentions: PromptTextMention[]) => {
      const current = inlineSessionRef.current;
      if (current) {
        current.setDraft((draft) => ({ ...draft, mentions, text }));
        return;
      }
      setStoredPromptTextAndMentions(text, mentions);
    },
    [inlineSessionRef, setStoredPromptTextAndMentions],
  );
  const removeActiveComposerAttachment = useCallback(
    (path: string) => {
      const current = inlineSessionRef.current;
      if (current) {
        current.setDraft((draft) => ({
          ...draft,
          attachments: draft.attachments.filter(
            (attachment) => attachment.path !== path,
          ),
        }));
        return;
      }
      removeStoredPromptAttachment(path);
    },
    [inlineSessionRef, removeStoredPromptAttachment],
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
