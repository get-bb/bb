import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import { WaveformVisualizer } from "./WaveformVisualizer.js";

interface VoiceRecordingBarProps {
  state: "recording" | "transcribing";
  stream: MediaStream | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const CONTROL_BUTTON_CLASS =
  "size-8 rounded-full p-0 max-md:pointer-coarse:size-10";

export function VoiceRecordingBar({
  state,
  stream,
  onConfirm,
  onCancel,
}: VoiceRecordingBarProps) {
  const isTranscribing = state === "transcribing";

  return (
    <div className="flex flex-row items-center gap-2 px-2 py-1.5">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={
          isTranscribing ? "Cancel transcription" : "Cancel recording"
        }
        onClick={onCancel}
        className={CONTROL_BUTTON_CLASS}
      >
        <Icon name="X" className="size-4" />
      </Button>
      <div className="relative flex min-w-0 flex-1 items-center">
        <div
          className={cn("h-7 w-full", isTranscribing && "animate-shine-icon")}
        >
          <WaveformVisualizer stream={stream} active={!isTranscribing} />
        </div>
        <span className="sr-only" aria-live="polite">
          {isTranscribing ? "Transcribing" : "Recording"}
        </span>
      </div>
      <Button
        type="button"
        size="icon"
        variant="default"
        aria-label={
          isTranscribing
            ? "Transcribing voice input"
            : "Stop and transcribe recording"
        }
        disabled={isTranscribing}
        onClick={onConfirm}
        className={CONTROL_BUTTON_CLASS}
      >
        {isTranscribing ? (
          <Icon name="Spinner" className="size-4 animate-spin" />
        ) : (
          <Icon name="Check" className="size-4" />
        )}
      </Button>
    </div>
  );
}
