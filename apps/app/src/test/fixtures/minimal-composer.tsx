import { useRef, useState, type KeyboardEvent } from "react";
import {
  experimental_ComposerRoot as ComposerRoot,
  experimental_useComposerContributions as useComposerContributions,
  experimental_useComposerRenderer as useComposerRenderer,
  useComposer,
  type ComposerDraft,
  type ComposerMention,
  type ExperimentalComposerEditor,
  type ExperimentalDroppedThreadMention,
} from "@get-bb/plugin-sdk/app";
import { setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";

export const MINIMAL_COMPOSER_PLUGIN_ID = "minimal-composer";

function shifted(mention: ComposerMention, delta: number): ComposerMention {
  return { ...mention, from: mention.from + delta, to: mention.to + delta };
}

function MinimalComposer() {
  const composer = useComposer();
  const renderer = useComposerRenderer();
  const { popups, Popup, Actions } = useComposerContributions();
  const rootRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [openPopupKey, setOpenPopupKey] = useState<string | null>(null);
  const openPopup = popups.find((popup) => popup.key === openPopupKey) ?? null;
  const { submission } = renderer.input;

  const insert = (value: ComposerDraft, at: number, end = at) => {
    composer.replace((current) => {
      const delta = value.text.length - (end - at);
      return {
        text: `${current.text.slice(0, at)}${value.text}${current.text.slice(end)}`,
        mentions: [
          ...current.mentions.filter((mention) => mention.to <= at),
          ...value.mentions.map((mention) => shifted(mention, at)),
          ...current.mentions
            .filter((mention) => mention.from >= end)
            .map((mention) => shifted(mention, delta)),
        ],
      };
    });
  };

  const caret = () => {
    const textarea = textareaRef.current;
    return textarea === null
      ? { from: composer.draft.text.length, to: composer.draft.text.length }
      : { from: textarea.selectionStart, to: textarea.selectionEnd };
  };

  const editor: ExperimentalComposerEditor = {
    state: {
      layout: "expanded",
      isRunning: submission.isRunning ?? false,
      isSubmitting: submission.isSubmitting ?? false,
      isSubmittingBlocked: submission?.disabled ?? false,
      submittingBlockedReason: submission?.disabledReason ?? null,
      isAttaching: renderer.input.attachments?.isAttaching ?? false,
      attachmentError: renderer.input.attachments?.error ?? null,
    },
    insertAtCursor(value) {
      if (textareaRef.current === null) return false;
      const { from, to } = caret();
      insert(value, from, to);
      return true;
    },
    focus() {
      const textarea = textareaRef.current;
      if (textarea === null || renderer.inputLocked) return false;
      textarea.focus();
      return true;
    },
    focusEnd() {
      const textarea = textareaRef.current;
      if (textarea === null) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    },
    acceptsThreadDrop: () => !renderer.inputLocked,
    insertDroppedThread(thread: ExperimentalDroppedThreadMention) {
      const text = `@thread:${thread.threadId}`;
      const at = composer.draft.text.length;
      insert(
        {
          text,
          mentions: [
            {
              kind: "thread",
              threadId: thread.threadId,
              label: thread.label,
              from: 0,
              to: text.length,
            },
          ],
        },
        at,
      );
    },
    openPopup(pluginId, popupId) {
      const popup = popups.find(
        (candidate) =>
          candidate.pluginId === pluginId && candidate.popup.id === popupId,
      );
      if (popup === undefined) return false;
      setOpenPopupKey(popup.key);
      return true;
    },
    closePopup(pluginId) {
      if (openPopup === null || openPopup.pluginId !== pluginId) return false;
      setOpenPopupKey(null);
      return true;
    },
    isPopupOpen: () => openPopup !== null,
    voice: {
      textBeforeCursor: () =>
        composer.draft.text.slice(0, caret().from) || null,
      deliverTranscript(text, delivery) {
        const { from, to } = caret();
        insert({ text, mentions: [] }, from, to);
        if (delivery === "send") submission.enter.run();
      },
      playCompletionTransition: () => Promise.resolve(),
    },
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (renderer.dispatchAppCommandKey(event.nativeEvent)) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) submission.modifier?.run();
    else submission.enter.run();
  };

  return (
    <form
      ref={rootRef}
      data-minimal-composer=""
      onSubmit={(event) => {
        event.preventDefault();
        submission.enter.run();
      }}
    >
      <ComposerRoot rootRef={rootRef} editor={editor} />
      <textarea
        ref={textareaRef}
        aria-label={renderer.input.placeholder ?? "Message"}
        value={composer.draft.text}
        readOnly={renderer.inputLocked}
        onChange={(event) =>
          composer.replace({ text: event.target.value, mentions: [] })
        }
        onKeyDown={handleKeyDown}
      />
      <Actions />
      {openPopup === null ? null : (
        <Popup contribution={openPopup} onClose={() => setOpenPopupKey(null)} />
      )}
    </form>
  );
}

export function registerMinimalComposer(): void {
  setPluginSlotRegistrations(
    MINIMAL_COMPOSER_PLUGIN_ID,
    makePluginRegistrationSet({
      composers: [
        {
          id: "minimal",
          title: "Minimal composer",
          component: MinimalComposer,
        },
      ],
    }),
  );
}
