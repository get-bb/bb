import { useLayoutEffect, useRef, useState } from "react";
import type { PromptDraftAttachment, PromptDraftState } from "@bb/client-core";
import type { PromptTextMention } from "@bb/domain";
import {
  createComposerDraftStore,
  type ComposerDraftStore,
} from "@/components/plugin/plugin-composer-host";
import {
  ComposerBox,
  type AttachmentsConfig,
  type ComposerBoxProps,
  type HistoryConfig,
} from "@/components/promptbox/ComposerBox";

export interface ControlledComposerBoxProps extends Omit<
  ComposerBoxProps,
  "attachments" | "draft" | "history"
> {
  value: string;
  mentionRanges: readonly PromptTextMention[];
  onChange(value: string, mentionRanges: PromptTextMention[]): void;
  attachments?: AttachmentsConfig & { items?: PromptDraftAttachment[] };
  history?: HistoryConfig & { currentDraft?: PromptDraftState };
}

const NO_ATTACHMENTS: PromptDraftAttachment[] = [];

function areMentionsEqual(
  left: readonly PromptTextMention[],
  right: readonly PromptTextMention[],
): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((mention, index) => mention === right[index]))
  );
}

export function ControlledComposerBox({
  value,
  mentionRanges,
  onChange,
  attachments,
  history,
  ...props
}: ControlledComposerBoxProps) {
  const items = attachments?.items ?? NO_ATTACHMENTS;
  const callbacksRef = useRef({ onChange, onUpdate: attachments?.onUpdate });
  useLayoutEffect(() => {
    callbacksRef.current = { onChange, onUpdate: attachments?.onUpdate };
  });
  const [{ controlled, draft }] = useState(() => {
    const store = createComposerDraftStore({
      text: value,
      mentions: [...mentionRanges],
      attachments: items,
    });
    const draftStore: ComposerDraftStore = {
      getCurrent: store.getCurrent,
      subscribeDraft: store.subscribeDraft,
      setDraft: (next) => {
        const previous = store.getCurrent();
        store.setDraft(next);
        callbacksRef.current.onChange(next.text, [...next.mentions]);
        if (next.attachments !== previous.attachments) {
          callbacksRef.current.onUpdate?.(() => next.attachments);
        }
      },
    };
    return { controlled: store, draft: draftStore };
  });
  useLayoutEffect(() => {
    const current = controlled.getCurrent();
    if (
      current.text === value &&
      areMentionsEqual(current.mentions, mentionRanges) &&
      current.attachments === items
    ) {
      return;
    }
    controlled.setDraft({
      text: value,
      mentions: [...mentionRanges],
      attachments: items,
    });
  }, [controlled, items, mentionRanges, value]);
  const composerHistory =
    history === undefined
      ? undefined
      : {
          entries: history.entries,
          onSelectEntry: history.onSelectEntry,
          resetKey: history.resetKey,
        };
  return (
    <ComposerBox
      {...props}
      draft={draft}
      attachments={attachments}
      history={composerHistory}
    />
  );
}
