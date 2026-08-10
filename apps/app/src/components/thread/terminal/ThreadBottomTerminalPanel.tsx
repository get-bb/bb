import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { useAtom } from "jotai";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { TabPill } from "@/components/ui/tab-pill";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import {
  terminalStatusLabel,
  useThreadTerminalController,
} from "./useThreadTerminalController";
import {
  getThreadBottomTerminalHeightAtom,
  MAX_BOTTOM_TERMINAL_HEIGHT_PERCENT,
  MIN_BOTTOM_TERMINAL_HEIGHT_PERCENT,
} from "./threadBottomTerminalPanelAtoms";

interface ThreadBottomTerminalPanelProps {
  canCreateTerminal: boolean;
  children: ReactNode;
  createRequestNonce: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
  threadId: string;
}

export function ThreadBottomTerminalPanel({
  canCreateTerminal,
  children,
  createRequestNonce,
  isOpen,
  onOpenChange,
  onOpenLink,
  onSelectionAddToChat,
  threadId,
}: ThreadBottomTerminalPanelProps) {
  const instanceId = useId().replaceAll(":", "");
  const terminalRegionId = `thread-bottom-terminal-${threadId}-${instanceId}`;
  const [heightPercent, setHeightPercent] = useAtom(
    getThreadBottomTerminalHeightAtom(threadId),
  );
  const latestHeightPercentRef = useRef(heightPercent);
  const handledCreateRequestRef = useRef(createRequestNonce);
  const controller = useThreadTerminalController({
    canCreateTerminal,
    isPanelOpen: isOpen,
    isPanelPersistedOpen: isOpen,
    panelStateId: `bottom-terminal:${threadId}`,
    syncThreadTabs: false,
    target: { kind: "thread", threadId },
  });
  const { handleCreateTerminal } = controller;

  useEffect(() => {
    latestHeightPercentRef.current = heightPercent;
  }, [heightPercent]);

  useEffect(() => {
    if (handledCreateRequestRef.current === createRequestNonce) return;
    handledCreateRequestRef.current = createRequestNonce;
    if (isOpen) handleCreateTerminal();
  }, [createRequestNonce, handleCreateTerminal, isOpen]);

  const handleResize = useCallback((size: number) => {
    if (size > 0) latestHeightPercentRef.current = size;
  }, []);
  const handleResizeDragging = useCallback(
    (dragging: boolean) => {
      if (!dragging) setHeightPercent(latestHeightPercentRef.current);
    },
    [setHeightPercent],
  );

  if (!isOpen) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">{children}</div>
        <button
          type="button"
          className="flex h-8 shrink-0 items-center gap-2 border-t border-border-seam bg-sidebar px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onOpenChange(true)}
          aria-expanded={false}
          aria-controls={terminalRegionId}
        >
          <Icon name="Terminal" className="size-3.5" aria-hidden />
          <span>Terminal</span>
          <Icon name="PanelBottom" className="ml-auto size-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <PanelGroup key={threadId} direction="vertical" className="h-full min-h-0">
      <Panel
        id={`thread-main-${threadId}-${instanceId}`}
        defaultSize={100 - heightPercent}
        minSize={100 - MAX_BOTTOM_TERMINAL_HEIGHT_PERCENT}
        order={1}
        className="min-h-0 overflow-clip"
      >
        {children}
      </Panel>
      <PanelResizeHandle
        id={`thread-bottom-terminal-handle-${threadId}-${instanceId}`}
        onDragging={handleResizeDragging}
        className="group relative z-10 h-0 shrink-0 cursor-row-resize"
        aria-label="Resize thread and terminal panel"
      >
        <span className="absolute inset-x-0 -top-1.5 h-3 bg-transparent group-hover:bg-accent/15" />
        <span className="absolute inset-x-0 top-0 h-px bg-border-seam group-hover:bg-accent-foreground/35" />
      </PanelResizeHandle>
      <Panel
        id={`thread-bottom-terminal-panel-${threadId}-${instanceId}`}
        defaultSize={heightPercent}
        minSize={MIN_BOTTOM_TERMINAL_HEIGHT_PERCENT}
        maxSize={MAX_BOTTOM_TERMINAL_HEIGHT_PERCENT}
        onResize={handleResize}
        order={2}
        className="min-h-0 overflow-hidden bg-sidebar"
      >
        <section
          id={terminalRegionId}
          aria-label="Terminal"
          data-app-terminal=""
          className="flex h-full min-h-0 flex-col bg-sidebar"
        >
          <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border-seam px-2">
            <div
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
              aria-label="Terminal tabs"
            >
              {controller.visibleSessions.map((session) => (
                <TabPill
                  key={session.id}
                  label={session.title}
                  labelClassName="font-mono"
                  title={session.title}
                  isActive={session.id === controller.activeTerminalId}
                  activeTreatment="underline"
                  leadingVisual={
                    <Icon name="Terminal" className="size-3.5" aria-hidden />
                  }
                  secondaryLabel={
                    session.status === "running"
                      ? null
                      : terminalStatusLabel(session)
                  }
                  onSelect={() => controller.handleSelectTerminal(session.id)}
                  closeAction={{
                    closeLabel: `Close ${session.title}`,
                    closeTooltip: `Close ${session.title}`,
                    isClosing: controller.closingTerminalId === session.id,
                    onClose: () => controller.handleCloseTerminal(session.id),
                  }}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 p-0"
              onClick={controller.handleCreateTerminal}
              disabled={
                !controller.canCreateTerminal ||
                controller.isCreateTerminalPending
              }
              aria-label="New terminal"
            >
              <Icon
                name={controller.isCreateTerminalPending ? "Spinner" : "Plus"}
                className={cn(
                  "size-3.5",
                  controller.isCreateTerminalPending && "animate-spin",
                )}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 p-0"
              onClick={() => onOpenChange(false)}
              aria-label="Collapse terminal panel"
              aria-expanded={true}
              aria-controls={terminalRegionId}
            >
              <Icon name="ChevronDown" className="size-3.5" />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ThreadTerminalContent
              controller={controller}
              onOpenLink={onOpenLink}
              onSelectionAddToChat={onSelectionAddToChat}
            />
          </div>
        </section>
      </Panel>
    </PanelGroup>
  );
}
