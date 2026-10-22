import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
import type { VoiceDelivery } from "@/lib/voice-recording-store";
import type { PromptBoxHandle, PromptVoiceConfig } from "./PromptBoxInternal";
import {
  deliverPromptVoiceTranscript,
  type PromptVoiceDraftTarget,
} from "./prompt-voice-intent";

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

export function usePromptVoice(
  promptBoxRef: RefObject<PromptBoxHandle | null>,
  draft: PromptVoiceDraftTarget | undefined,
  recordingKey: string | null,
): PromptVoiceConfig {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onTranscript = useCallback(
    (text: string, delivery: VoiceDelivery) =>
      deliverPromptVoiceTranscript(text, delivery, {
        mounted: mountedRef.current,
        promptBox: promptBoxRef.current,
        draft,
      }),
    [draft, promptBoxRef],
  );

  const getPromptContext = useCallback(
    () => promptBoxRef.current?.voice.textBeforeCursor() ?? undefined,
    [promptBoxRef],
  );

  const playCompletionTransition = useCallback(
    () => promptBoxRef.current?.voice.playCompletionTransition(),
    [promptBoxRef],
  );

  const voiceInput = useVoiceInput({
    recordingKey,
    onTranscript,
    onTranscribe: requestVoiceTranscription,
    getPromptContext,
    playCompletionTransition,
  });

  const { stop: stopVoiceInput } = voiceInput;
  const stop = useCallback(() => stopVoiceInput("insert"), [stopVoiceInput]);
  const send = useCallback(() => stopVoiceInput("send"), [stopVoiceInput]);

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      delivery: voiceInput.delivery,
      microphoneWarning: voiceInput.microphoneWarning,
      isSupported: voiceInput.isSupported,
      stream: voiceInput.stream,
      failedRecordings: voiceInput.failedRecordings,
      start: voiceInput.start,
      stop,
      send,
      retry: voiceInput.retry,
      discard: voiceInput.discard,
      download: voiceInput.download,
      cancel: voiceInput.cancel,
    }),
    [
      voiceInput.state,
      voiceInput.delivery,
      voiceInput.microphoneWarning,
      voiceInput.isSupported,
      voiceInput.stream,
      voiceInput.failedRecordings,
      voiceInput.start,
      stop,
      send,
      voiceInput.retry,
      voiceInput.discard,
      voiceInput.download,
      voiceInput.cancel,
    ],
  );
}
