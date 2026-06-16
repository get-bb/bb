import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import { useThreadTerminalController } from "./useThreadTerminalController";

interface ThreadTerminalPanelProps {
  canCreateTerminal: boolean;
  onOpenLink?: MarkdownPreviewLinkHandler;
  threadId: string;
}

export function ThreadTerminalPanel({
  canCreateTerminal,
  onOpenLink,
  threadId,
}: ThreadTerminalPanelProps) {
  const terminalController = useThreadTerminalController({
    canCreateTerminal,
    threadId,
  });

  return (
    <section
      aria-label="Thread terminal"
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <ThreadTerminalContent
          controller={terminalController}
          onOpenLink={onOpenLink}
        />
      </div>
    </section>
  );
}
