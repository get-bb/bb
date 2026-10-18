import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import type { FailedVoiceRecording } from "@/lib/voice-recording-store";

interface FailedVoiceRecordingsProps {
  recordings: readonly FailedVoiceRecording[];
  className: string;
  retryDisabled: boolean;
  onRetry: (recording: FailedVoiceRecording) => void;
  onDownload: (recording: FailedVoiceRecording) => void;
  onDiscard: (recording: FailedVoiceRecording) => void;
}

const ACTION_BUTTON_CLASS = "h-7 shrink-0 px-2.5 max-md:pointer-coarse:h-8";
const ICON_BUTTON_CLASS =
  "size-7 shrink-0 rounded-md p-0 text-muted-foreground max-md:pointer-coarse:size-8";

export function FailedVoiceRecordings({
  recordings,
  className,
  retryDisabled,
  onRetry,
  onDownload,
  onDiscard,
}: FailedVoiceRecordingsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-promptbox-failed-voice-recordings=""
        className={cn("flex flex-col gap-1", className)}
      >
        {recordings.map((recording) => {
          const errorMessage =
            recording.errorMessage ?? "Transcription did not finish";
          return (
            <div
              key={recording.id}
              role="group"
              aria-label="Voice input failed"
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 rounded-lg bg-muted py-1 pl-2.5 pr-1 md:flex"
            >
              <Icon
                name="Mic"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="flex min-w-0 flex-1 overflow-hidden whitespace-nowrap px-1 text-xs">
                    <span className="shrink-0">Voice input failed</span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      &nbsp;· {errorMessage}
                    </span>
                  </p>
                </TooltipTrigger>
                <TooltipContent side="top">{errorMessage}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Discard recording"
                    onClick={() => onDiscard(recording)}
                    className={cn(ICON_BUTTON_CLASS, "md:order-last")}
                  >
                    <Icon name="X" className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Discard recording</TooltipContent>
              </Tooltip>
              <div className="col-start-2 flex items-center gap-1 pb-0.5 md:contents">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={retryDisabled || recording.retrying}
                  onClick={() => onRetry(recording)}
                  className={cn(
                    ACTION_BUTTON_CLASS,
                    recording.retrying && "disabled:opacity-100",
                  )}
                >
                  {recording.retrying ? "Retrying…" : "Retry"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onDownload(recording)}
                  className={cn(ACTION_BUTTON_CLASS, "text-muted-foreground")}
                >
                  Download
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
