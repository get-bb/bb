import { Button } from "@bb/shared-ui/button";

interface WidgetVoiceReadyPromptProps {
  onDismiss: () => void;
  onStart: () => void;
  supported: boolean;
  unsupportedMessage: string;
}

export function WidgetVoiceReadyPrompt({
  onDismiss,
  onStart,
  supported,
  unsupportedMessage,
}: WidgetVoiceReadyPromptProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Ready to record</p>
        <p className="text-xs text-muted-foreground">
          {supported ? "Choose when to start voice input." : unsupportedMessage}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" onClick={onStart} disabled={!supported}>
          Start voice input
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Dismiss voice input prompt"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
