import type { TerminalSession } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
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

interface InactiveTerminalContent {
  canStartReplacement: boolean;
  description: string | null;
  title: string;
}

interface GetInactiveTerminalContentArgs {
  canCreateTerminal: boolean;
  status: TerminalSession["status"];
}

function getInactiveTerminalContent({
  canCreateTerminal,
  status,
}: GetInactiveTerminalContentArgs): InactiveTerminalContent {
  switch (status) {
    case "disconnected":
      return {
        canStartReplacement: canCreateTerminal,
        description: null,
        title: "Terminal disconnected",
      };
    case "exited":
      return {
        canStartReplacement: false,
        description: null,
        title: "Terminal exited",
      };
    case "starting":
      return {
        canStartReplacement: false,
        description: null,
        title: "Terminal starting",
      };
    case "running":
      return {
        canStartReplacement: false,
        description: null,
        title: "Terminal running",
      };
  }
}

export function ThreadTerminalContent({
  autoFocus = false,
  controller,
  onAutoFocusHandled,
  onOpenLink,
  onSelectionAddToChat,
}: ThreadTerminalContentProps) {
  // Keep the terminal UI entirely unmounted until its panel is shown: mounting
  // ThreadTerminalView initializes xterm and its socket. Once mounted, a
  // hidden-but-persisted panel (compact drawer closed) keeps it alive so the
  // next open does not re-create xterm and replay the scrollback.
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

  const shouldRenderTerminalView =
    controller.activeSession.status === "running" ||
    controller.shouldRetainActiveTerminalView;

  if (!shouldRenderTerminalView) {
    const inactiveContent = getInactiveTerminalContent({
      canCreateTerminal: controller.canCreateTerminal,
      status: controller.activeSession.status,
    });

    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm">
        <div className="flex max-w-md flex-col items-center gap-3">
          <div>
            <p className="font-medium text-foreground">
              {inactiveContent.title}
            </p>
            {inactiveContent.description !== null ? (
              <p className="mt-1 text-muted-foreground">
                {inactiveContent.description}
              </p>
            ) : null}
          </div>
          {inactiveContent.canStartReplacement ? (
            <Button
              type="button"
              size="sm"
              onClick={controller.handleCreateTerminal}
              disabled={controller.isCreateTerminalPending}
            >
              {controller.isCreateTerminalPending ? (
                <Icon name="Spinner" className="size-3.5 animate-spin" />
              ) : (
                <Icon name="Plus" className="size-3.5" />
              )}
              Start new terminal
            </Button>
          ) : null}
        </div>
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
      onUserInput={controller.handleActiveTerminalUserInput}
      session={controller.activeSession}
    />
  );
}
