import type { PromptDraftState } from "@bb/client-core";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import type { PromptBoxHandle, PromptVoiceConfig } from "./PromptBoxInternal";

export interface PromptVoiceDraftTarget {
  getCurrent: () => PromptDraftState;
  setDraft: (draft: PromptDraftState) => void;
  submit?: PluginComposerHost["submit"];
}

interface PromptVoiceTranscriptTarget {
  promptBox: PromptBoxHandle | null;
  draft: PromptVoiceDraftTarget | undefined;
}

export interface PromptVoiceIntent {
  setMounted: (mounted: boolean) => void;
  claimStop: (state: PromptVoiceConfig["state"], send: boolean) => boolean;
  cancel: () => void;
  settle: (state: PromptVoiceConfig["state"]) => void;
  deliverTranscript: (
    text: string,
    target: PromptVoiceTranscriptTarget,
  ) => Promise<void> | undefined;
}

export function createPromptVoiceIntent(): PromptVoiceIntent {
  let sendPending = false;
  let stopped = false;
  let mounted = true;
  return {
    setMounted: (next) => {
      mounted = next;
    },
    claimStop: (state, send) => {
      if (state !== "recording" || stopped) return false;
      stopped = true;
      sendPending = send;
      return true;
    },
    cancel: () => {
      sendPending = false;
      stopped = false;
    },
    settle: (state) => {
      if (state !== "recording" && state !== "transcribing") {
        stopped = false;
        sendPending = false;
      }
    },
    deliverTranscript: (text, { promptBox, draft }) => {
      const send = sendPending;
      sendPending = false;
      stopped = false;
      if (mounted && promptBox) {
        if (send) {
          promptBox.sendVoiceTranscript(text);
        } else {
          promptBox.insertTextAtCursor(text);
        }
        return;
      }
      if (!draft) return;
      const current = draft.getCurrent();
      const separator =
        current.text.length > 0 && !/\s$/.test(current.text) ? " " : "";
      draft.setDraft({
        ...current,
        text: `${current.text}${separator}${text}`,
      });
      if (send) return draft.submit?.({ experimental_data: null }, undefined);
    },
  };
}

export async function transcribeAfterCompletionTransition(
  transcribe: () => Promise<string>,
  playCompletionTransition: () => Promise<void> | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const text = await transcribe();
  await playCompletionTransition();
  if (signal?.aborted) {
    throw new DOMException("Voice transcription was cancelled", "AbortError");
  }
  return text;
}
