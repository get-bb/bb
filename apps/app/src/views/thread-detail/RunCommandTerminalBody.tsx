import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { ThreadTerminalView } from "@/components/thread/terminal/ThreadTerminalView";
import type { ThreadRunCommandTerminal } from "./useThreadRunCommandTerminal";

interface RunCommandTerminalBodyProps {
  runCommandTerminal: ThreadRunCommandTerminal;
  isPanelOpen: boolean;
  onStartRunCommand: () => void;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
}

/**
 * Renders the pinned Run tab's body: the live run-command terminal when its
 * session is available, else a Start affordance. Shared by the desktop dock and
 * the mobile drawer so the run surfaces identically on both.
 */
export function RunCommandTerminalBody({
  runCommandTerminal,
  isPanelOpen,
  onStartRunCommand,
  onOpenLink,
  onSelectionAddToChat,
}: RunCommandTerminalBodyProps) {
  const { runSession, runActive, runConfigured, isRunCommandPending } =
    runCommandTerminal;
  if (runSession) {
    return (
      <ThreadTerminalView
        session={runSession}
        isPanelOpen={isPanelOpen}
        onOpenLink={onOpenLink}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
      {runActive ? (
        <p>Connecting to run command…</p>
      ) : (
        <>
          <p>The run command is not running.</p>
          <Button
            type="button"
            size="sm"
            disabled={!runConfigured || isRunCommandPending}
            onClick={onStartRunCommand}
          >
            <Icon
              name={isRunCommandPending ? "Spinner" : "Play"}
              className={cn("size-3.5", isRunCommandPending && "animate-spin")}
            />
            Start run command
          </Button>
        </>
      )}
    </div>
  );
}
