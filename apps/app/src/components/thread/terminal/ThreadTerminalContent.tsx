import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { ThreadTerminalView } from "./ThreadTerminalView";
import type { ThreadTerminalController } from "./useThreadTerminalController";

interface ThreadTerminalContentProps {
  autoFocus?: boolean;
  controller: ThreadTerminalController;
  onAutoFocusHandled?: () => void;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
}

export function ThreadTerminalContent({
  autoFocus = false,
  controller,
  onAutoFocusHandled,
  onOpenLink,
  onSelectionAddToChat,
}: ThreadTerminalContentProps) {
  if (!controller.shouldMountTerminalView) {
    return null;
  }

  if (controller.hasTerminalQueryError) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive-text">
        Failed to load terminals.
      </div>
    );
  }

  if (!controller.activeSession) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {controller.terminalBodyMessage}
      </div>
    );
  }

  const status = controller.activeSession.status;
  if (status !== "running" && status !== "disconnected") {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm">
        <p className="font-medium text-foreground">
          {status === "exited" ? "Terminal exited" : "Terminal starting"}
        </p>
      </div>
    );
  }

  return (
    <ThreadTerminalView
      autoFocus={autoFocus}
      isPanelOpen={controller.isPanelOpen}
      onAutoFocusHandled={onAutoFocusHandled}
      onOpenLink={onOpenLink}
      onSelectionAddToChat={onSelectionAddToChat}
      onSessionChange={controller.handleActiveTerminalSessionChange}
      onTitleChange={controller.handleActiveTerminalTitleChange}
      session={controller.activeSession}
    />
  );
}
