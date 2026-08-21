import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isRecordingLongEnough,
  normalizeTranscript,
  resolveVoiceErrorMessage,
  useVoiceTranscription,
  VOICE_EMPTY_TRANSCRIPT_MESSAGE,
  VOICE_PERMISSION_DENIED_MESSAGE,
  VOICE_TOO_SHORT_MESSAGE,
  voiceRecordingFileFromUri,
  type VoiceInputState,
} from "@/data/composer";
import { toast } from "@/ui";
import { meteringToAmplitude } from "./voice-waveform-model";

const KEEP_AWAKE_TAG = "bb-composer-voice";
/** The web preset plus metering so the recording bar can draw sound waves. */
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

export interface UseComposerVoiceArgs {
  /** `/system/config` `voiceTranscriptionEnabled`. */
  enabled: boolean;
  /** Text before the caret, sent as transcription context. */
  getPromptContext: () => string | undefined;
  onTranscript: (text: string) => void;
}

export interface ComposerVoiceController {
  enabled: boolean;
  state: VoiceInputState;
  /**
   * Current input level as a waveform bar amplitude in `0..1` (the recorder's
   * metering; 0 outside a recording). Polled by `VoiceWaveform`.
   */
  readLevel: () => number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
}

/**
 * Mic button state machine (port of the web `useVoiceInput`): idle →
 * recording (expo-audio, m4a, screen kept awake) → transcribing (multipart
 * `POST /system/voice-transcription`) → idle, with `error` on any failure
 * (toast "Voice input failed" + the mapped reason). A recording under one
 * second is discarded; cancel during recording drops the take and during
 * transcription aborts the request.
 */
export function useComposerVoice({
  enabled,
  getPromptContext,
  onTranscript,
}: UseComposerVoiceArgs): ComposerVoiceController {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const transcription = useVoiceTranscription();
  const [state, setState] = useState<VoiceInputState>("idle");
  const startedAtRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<VoiceInputState>("idle");
  stateRef.current = state;

  const fail = useCallback((message: string) => {
    setState("error");
    toast.error("Voice input failed", { description: message });
  }, []);

  const readLevel = useCallback(() => {
    if (stateRef.current !== "recording") return 0;
    return meteringToAmplitude(recorder.getStatus().metering);
  }, [recorder]);

  const releaseRecording = useCallback(async () => {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // Audio mode restore is best-effort.
    }
  }, []);

  useEffect(
    () => () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      abortRef.current?.abort();
    },
    [],
  );

  const start = useCallback(async () => {
    if (!enabled) {
      fail("Voice transcription is disabled on this server.");
      return;
    }
    if (
      stateRef.current === "recording" ||
      stateRef.current === "transcribing"
    ) {
      return;
    }
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        fail(VOICE_PERMISSION_DENIED_MESSAGE);
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      setState("recording");
    } catch (error) {
      await releaseRecording();
      fail(resolveVoiceErrorMessage(error));
    }
  }, [enabled, fail, recorder, releaseRecording]);

  const stop = useCallback(async () => {
    if (stateRef.current !== "recording") return;
    const startedAt = startedAtRef.current ?? Date.now();
    startedAtRef.current = null;
    const promptContext = getPromptContext();
    try {
      await recorder.stop();
    } catch (error) {
      await releaseRecording();
      fail(resolveVoiceErrorMessage(error));
      return;
    }
    await releaseRecording();
    const durationMs = Date.now() - startedAt;
    if (!isRecordingLongEnough(durationMs)) {
      fail(VOICE_TOO_SHORT_MESSAGE);
      return;
    }
    const uri = recorder.uri;
    if (!uri) {
      fail("No audio was captured");
      return;
    }
    setState("transcribing");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const raw = await transcription.mutateAsync({
        file: voiceRecordingFileFromUri(uri),
        prompt: promptContext,
        signal: controller.signal,
      });
      const normalized = normalizeTranscript(raw);
      if (normalized.length === 0) {
        throw new Error(VOICE_EMPTY_TRANSCRIPT_MESSAGE);
      }
      onTranscript(normalized);
      setState("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        setState("idle");
        return;
      }
      fail(resolveVoiceErrorMessage(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [
    fail,
    getPromptContext,
    onTranscript,
    recorder,
    releaseRecording,
    transcription,
  ]);

  const cancel = useCallback(() => {
    if (stateRef.current === "recording") {
      startedAtRef.current = null;
      void recorder
        .stop()
        .catch(() => undefined)
        .finally(() => {
          void releaseRecording();
          setState("idle");
        });
      return;
    }
    if (stateRef.current === "transcribing") {
      abortRef.current?.abort();
      abortRef.current = null;
      setState("idle");
      return;
    }
    if (stateRef.current === "error") setState("idle");
  }, [recorder, releaseRecording]);

  return { enabled, state, readLevel, start, stop, cancel };
}
