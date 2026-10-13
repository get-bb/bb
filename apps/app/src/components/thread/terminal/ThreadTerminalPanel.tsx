import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import type { TerminalCreateTarget } from "@bb/server-contract";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import type { TerminalCommandBlockAddToChatHandler } from "./ThreadTerminalView";
import { useThreadTerminalController } from "./useThreadTerminalController";

interface ThreadTerminalPanelProps {
  autoFocus?: boolean;
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
  onAutoFocusHandled?: () => void;
  onCommandBlockAddToChat?: TerminalCommandBlockAddToChatHandler;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
  terminalId: string;
  target: TerminalCreateTarget;
}

export function ThreadTerminalPanel({
  autoFocus = false,
  isPanelOpen,
  isPanelPersistedOpen,
  onAutoFocusHandled,
  onCommandBlockAddToChat,
  onOpenLink,
  onSelectionAddToChat,
  terminalId,
  target,
}: ThreadTerminalPanelProps) {
  const terminalController = useThreadTerminalController({
    isPanelOpen,
    isPanelPersistedOpen,
    terminalId,
    target,
  });

  return (
    <section
      aria-label="Terminal"
      data-app-terminal=""
      className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar"
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-sidebar">
        <ThreadTerminalContent
          autoFocus={autoFocus}
          controller={terminalController}
          onAutoFocusHandled={onAutoFocusHandled}
          onCommandBlockAddToChat={onCommandBlockAddToChat}
          onOpenLink={onOpenLink}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      </div>
    </section>
  );
}
