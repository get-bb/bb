import { useEffect, useRef } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import type { VoiceInputTextareaProps } from "@bb/shared-ui/voice-input-textarea";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { VoiceInputButton } from "./VoiceInputButton";

function appendTranscript(value: string, transcript: string): string {
  return value && !/\s$/.test(value)
    ? `${value} ${transcript}`
    : `${value}${transcript}`;
}

export function VoiceInputTextarea({
  value,
  onValueChange,
  onVoiceInputActiveChange,
  disabled,
  className,
  ...props
}: VoiceInputTextareaProps) {
  const mountedRef = useRef(true);
  const latestRef = useRef({ value, onValueChange, onVoiceInputActiveChange });
  useEffect(() => {
    latestRef.current = { value, onValueChange, onVoiceInputActiveChange };
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestRef.current.onVoiceInputActiveChange?.(false);
    };
  }, []);

  const voice = useVoiceInput({
    onTranscribe: async ({ file, signal }) => {
      if (!mountedRef.current)
        throw new DOMException("Cancelled", "AbortError");
      const result = await transcribeVoiceInput(file, undefined, signal);
      if (!mountedRef.current)
        throw new DOMException("Cancelled", "AbortError");
      return result.text;
    },
    onTranscript: (transcript) => {
      if (!mountedRef.current) return;
      const latest = latestRef.current;
      latest.onValueChange(appendTranscript(latest.value, transcript));
    },
  });

  useEffect(() => {
    latestRef.current.onVoiceInputActiveChange?.(voice.isListening);
  }, [voice.isListening]);

  return (
    <div className="relative">
      <textarea
        {...props}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          className,
          voice.isSupported && "pb-12 max-md:pointer-coarse:pb-14",
        )}
      />
      {voice.isSupported ? (
        <div className="absolute inset-x-1 bottom-1 flex items-center justify-end gap-2">
          {voice.isListening ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={
                  voice.isProcessing
                    ? "Cancel transcription"
                    : "Cancel recording"
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
                    : "Stop and add text"
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
            <TooltipProvider>
              <VoiceInputButton
                warning={voice.microphoneWarning}
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
              </VoiceInputButton>
            </TooltipProvider>
          )}
        </div>
      ) : null}
    </div>
  );
}
