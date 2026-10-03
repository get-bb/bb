import { useEffect, useRef } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
import { WaveformVisualizer } from "@/components/promptbox/WaveformVisualizer";

export function QuestionVoiceInput({
  disabled,
  onTranscript,
  onBusyChange,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const mountedRef = useRef(true);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);

  const voice = useVoiceInput({
    onTranscribe: async ({ file, signal }) => {
      if (!mountedRef.current)
        throw new DOMException("Cancelled", "AbortError");
      const result = await transcribeVoiceInput(file, undefined, signal);
      if (!mountedRef.current)
        throw new DOMException("Cancelled", "AbortError");
      return result.text;
    },
    onTranscript: (text) => {
      if (mountedRef.current) onTranscriptRef.current(text);
    },
  });

  useEffect(() => {
    onBusyChange(voice.isListening);
  }, [onBusyChange, voice.isListening]);

  if (!voice.isSupported) return null;

  return (
    <div className="absolute inset-x-1 bottom-1 flex items-center justify-end gap-2">
      {voice.isListening ? (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={
              voice.isProcessing ? "Cancel transcription" : "Cancel recording"
            }
            className="size-8 rounded-full p-0 max-md:pointer-coarse:size-10"
            onClick={voice.cancel}
            disabled={disabled}
          >
            <Icon name="X" className="size-4" />
          </Button>
          <div className="h-7 min-w-0 flex-1">
            <WaveformVisualizer
              stream={voice.stream}
              active={voice.isRecording}
            />
          </div>
          <span className="sr-only" aria-live="polite">
            {voice.isProcessing ? "Transcribing" : "Recording"}
          </span>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label={
              voice.isProcessing
                ? "Transcribing voice input"
                : "Stop and add to answer"
            }
            className="size-8 rounded-md p-0 max-md:pointer-coarse:size-10"
            disabled={disabled || voice.isProcessing}
            onClick={voice.stop}
          >
            <Icon
              name={voice.isProcessing ? "Spinner" : "Square"}
              className={
                voice.isProcessing
                  ? "size-4 animate-spin"
                  : "size-3.5 fill-current [&_*]:stroke-0"
              }
            />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Start voice input"
          className="size-8 rounded-md p-0 max-md:pointer-coarse:size-10"
          disabled={disabled}
          onClick={() => {
            if (document.activeElement instanceof HTMLElement)
              document.activeElement.blur();
            void voice.start();
          }}
        >
          <Icon name="Mic" className="size-4" />
        </Button>
      )}
    </div>
  );
}
