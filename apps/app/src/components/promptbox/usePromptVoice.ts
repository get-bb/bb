import { useCallback, useMemo, type RefObject } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
import type { PromptBoxHandle, PromptVoiceConfig } from "./PromptBoxInternal";

async function requestVoiceTranscription({
  file,
  promptContext,
  signal,
}: {
  file: File;
  promptContext?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const transcription = await transcribeVoiceInput(file, promptContext, signal);
  return transcription.text;
}

function createVoiceAbortError(): DOMException {
  return new DOMException("Voice transcription was cancelled", "AbortError");
}

export function usePromptVoice(
  promptBoxRef: RefObject<PromptBoxHandle | null>,
): PromptVoiceConfig {
  const onTranscript = useCallback(
    (text: string) => {
      promptBoxRef.current?.insertTextAtCursor(text);
    },
    [promptBoxRef],
  );

  const getPromptContext = useCallback(
    () => promptBoxRef.current?.getTextBeforeCursor(),
    [promptBoxRef],
  );

  const transcribeAfterCompletionTransition = useCallback(
    async (args: Parameters<typeof requestVoiceTranscription>[0]) => {
      const text = await requestVoiceTranscription(args);
      await promptBoxRef.current?.playVoiceCompletionTransition();
      if (args.signal?.aborted) {
        throw createVoiceAbortError();
      }
      return text;
    },
    [promptBoxRef],
  );

  const voiceInput = useVoiceInput({
    onTranscript,
    onTranscribe: transcribeAfterCompletionTransition,
    getPromptContext,
  });

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      isSupported: voiceInput.isSupported,
      stream: voiceInput.stream,
      start: voiceInput.start,
      stop: voiceInput.stop,
      cancel: voiceInput.cancel,
    }),
    [
      voiceInput.state,
      voiceInput.isSupported,
      voiceInput.stream,
      voiceInput.start,
      voiceInput.stop,
      voiceInput.cancel,
    ],
  );
}
