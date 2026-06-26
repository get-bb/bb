import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import {
  useThreadTerminalController,
  type ThreadTerminalTarget,
} from "./useThreadTerminalController";

interface ThreadTerminalPanelProps {
  canCreateTerminal: boolean;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
  panelStateId?: string;
  target: ThreadTerminalTarget;
}

export function ThreadTerminalPanel({
  canCreateTerminal,
  onOpenLink,
  onSelectionAddToChat,
  panelStateId,
  target,
}: ThreadTerminalPanelProps) {
  const terminalController = useThreadTerminalController({
    canCreateTerminal,
    panelStateId,
    target,
  });

  return (
    <section
      aria-label="Terminal"
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <ThreadTerminalContent
          controller={terminalController}
          onOpenLink={onOpenLink}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      </div>
    </section>
  );
}
