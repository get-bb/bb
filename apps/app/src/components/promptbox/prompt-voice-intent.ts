import type { PromptDraftState } from "@bb/client-core";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import type { VoiceDelivery } from "@/lib/voice-recording-store";
import type { PromptBoxHandle } from "./PromptBoxInternal";

export interface PromptVoiceDraftTarget {
  getCurrent: () => PromptDraftState;
  setDraft: (draft: PromptDraftState) => void;
  submit?: PluginComposerHost["submit"];
}

interface PromptVoiceTranscriptTarget {
  mounted: boolean;
  promptBox: PromptBoxHandle | null;
  draft: PromptVoiceDraftTarget | undefined;
}

export function deliverPromptVoiceTranscript(
  text: string,
  delivery: VoiceDelivery,
  { mounted, promptBox, draft }: PromptVoiceTranscriptTarget,
): Promise<void> | undefined {
  const send = delivery === "send";
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
}
