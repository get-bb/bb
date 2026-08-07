import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import type {
  CreateTerminalRequest,
  TerminalSession,
} from "@bb/server-contract";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import {
  useThreadTerminalController,
  type ThreadTerminalTarget,
} from "./useThreadTerminalController";

interface ThreadTerminalPanelProps {
  canCreateTerminal: boolean;
  forceOpen?: boolean;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
  panelStateId?: string;
  purpose?: NonNullable<TerminalSession["purpose"]>;
  start?: CreateTerminalRequest["start"];
  target: ThreadTerminalTarget;
  title?: string;
}

export function ThreadTerminalPanel({
  canCreateTerminal,
  forceOpen,
  onOpenLink,
  onSelectionAddToChat,
  panelStateId,
  purpose,
  start,
  target,
  title,
}: ThreadTerminalPanelProps) {
  const terminalController = useThreadTerminalController({
    canCreateTerminal,
    forceOpen,
    panelStateId,
    purpose,
    start,
    target,
    title,
  });

  return (
    <section
      aria-label="Terminal"
      data-app-terminal=""
      className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar"
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-sidebar">
        <ThreadTerminalContent
          controller={terminalController}
          onOpenLink={onOpenLink}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      </div>
    </section>
  );
}
