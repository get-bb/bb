import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
import type { PromptDraftState } from "@bb/client-core";
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
  draft?: {
    getCurrent: () => PromptDraftState;
    setDraft: (draft: PromptDraftState) => void;
  },
): PromptVoiceConfig {
  const sendPendingRef = useRef(false);
  const stoppedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sendPendingRef.current = false;
    };
  }, []);

  const onTranscript = useCallback(
    (text: string) => {
      const send = sendPendingRef.current;
      sendPendingRef.current = false;
      stoppedRef.current = false;
      if (mountedRef.current && promptBoxRef.current) {
        if (send) {
          promptBoxRef.current.sendVoiceTranscript(text);
        } else {
          promptBoxRef.current.insertTextAtCursor(text);
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
    },
    [draft, promptBoxRef],
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

  const stop = useCallback(() => {
    if (voiceInput.state !== "recording" || stoppedRef.current) return;
    stoppedRef.current = true;
    sendPendingRef.current = false;
    voiceInput.stop();
  }, [voiceInput]);
  const send = useCallback(() => {
    if (voiceInput.state !== "recording" || stoppedRef.current) return;
    stoppedRef.current = true;
    sendPendingRef.current = true;
    voiceInput.stop();
  }, [voiceInput]);
  const cancel = useCallback(() => {
    sendPendingRef.current = false;
    stoppedRef.current = false;
    voiceInput.cancel();
  }, [voiceInput]);
  useEffect(() => {
    if (
      voiceInput.state !== "recording" &&
      voiceInput.state !== "transcribing"
    ) {
      stoppedRef.current = false;
      sendPendingRef.current = false;
    }
  }, [voiceInput.state]);

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      microphoneWarning: voiceInput.microphoneWarning,
      isSupported: voiceInput.isSupported,
      stream: voiceInput.stream,
      start: voiceInput.start,
      stop,
      send,
      cancel,
    }),
    [
      voiceInput.state,
      voiceInput.microphoneWarning,
      voiceInput.isSupported,
      voiceInput.stream,
      voiceInput.start,
      stop,
      send,
      cancel,
    ],
  );
}
