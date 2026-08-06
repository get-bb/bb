import { useEffect, useMemo, useState } from "react";
import type { TerminalSessionPurpose } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ThreadTerminalContent } from "@/components/thread/terminal/ThreadTerminalContent";
import { useThreadTerminalController } from "@/components/thread/terminal/useThreadTerminalController";
import { sdk } from "@/lib/sdk";
import { isLoopbackBrowserUrl } from "@/lib/browser-url";

const SETUP_FALLBACK_COMMAND =
  "if [ -f .bb-env-setup.sh ]; then bash .bb-env-setup.sh; else echo 'No setup script configured.'; fi";

interface WorkspaceProcessTerminalProps {
  canCreateTerminal: boolean;
  command: string | null;
  environmentId: string;
  onOpenPreview: (url: string) => void;
  purpose: TerminalSessionPurpose;
}

const ANSI_SEQUENCE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const HTTP_URL_PATTERN = /https?:\/\/[^\s\u001b]+/giu;

export function findLatestLoopbackPreviewUrl(output: string): string | null {
  const matches = output
    .replace(ANSI_SEQUENCE_PATTERN, "")
    .match(HTTP_URL_PATTERN);
  if (!matches) return null;
  for (const candidate of matches.slice().reverse()) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/u, ""));
      if (isLoopbackBrowserUrl(url.href)) {
        return url.href;
      }
    } catch {
      // Ignore malformed output and keep looking for an earlier valid URL.
    }
  }
  return null;
}

function decodeTerminalChunks(
  chunks: readonly { dataBase64: string }[],
): string {
  const bytes: number[] = [];
  for (const chunk of chunks) {
    const binary = window.atob(chunk.dataBase64);
    for (let index = 0; index < binary.length; index += 1) {
      bytes.push(binary.charCodeAt(index));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function WorkspaceProcessTerminal({
  canCreateTerminal,
  command,
  environmentId,
  onOpenPreview,
  purpose,
}: WorkspaceProcessTerminalProps) {
  const effectiveCommand =
    purpose === "setup" ? (command ?? SETUP_FALLBACK_COMMAND) : command;
  const title =
    purpose === "setup" ? "Setup" : purpose === "run" ? "Run" : "Terminal";
  const controller = useThreadTerminalController({
    canCreateTerminal:
      canCreateTerminal && (purpose === "shell" || effectiveCommand !== null),
    forceOpen: true,
    panelStateId: `${environmentId}:workspace:${purpose}`,
    purpose,
    ...(purpose === "shell"
      ? { start: { mode: "shell" as const } }
      : effectiveCommand
        ? { start: { mode: "command" as const, command: effectiveCommand } }
        : {}),
    target: { kind: "environment", environmentId },
    title,
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const activeSession = controller.activeSession;

  useEffect(() => {
    if (purpose !== "run" || activeSession?.status !== "running") {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    const readOutput = async () => {
      try {
        const response = await sdk.terminals.output({
          terminalId: activeSession.id,
          tailBytes: 64 * 1024,
          limitChunks: 200,
        });
        if (!cancelled) {
          setPreviewUrl(
            findLatestLoopbackPreviewUrl(decodeTerminalChunks(response.chunks)),
          );
        }
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    };
    void readOutput();
    const interval = window.setInterval(() => void readOutput(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSession?.id, activeSession?.status, purpose]);

  const emptyMessage = useMemo(() => {
    if (purpose === "run" && effectiveCommand === null) {
      return "Add a Run script in project settings.";
    }
    if (purpose === "setup") {
      return "Initial setup finished during provisioning. Rerun it here when needed.";
    }
    return "Start a terminal in this worktree.";
  }, [effectiveCommand, purpose]);

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar"
      aria-label={`${title} terminal`}
    >
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border-seam px-1.5">
        {purpose === "run" && previewUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpenPreview(previewUrl)}
          >
            <Icon name="ArrowUpRight" className="size-3.5" />
            Open preview
          </Button>
        ) : null}
        {activeSession?.status === "running" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => controller.handleCloseTerminal(activeSession.id)}
          >
            <Icon name="Square" className="size-3" />
            Stop
          </Button>
        ) : controller.canCreateTerminal ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={controller.isCreateTerminalPending}
            onClick={controller.handleCreateTerminal}
          >
            {controller.isCreateTerminalPending ? (
              <Icon name="Spinner" className="size-3.5 animate-spin" />
            ) : (
              <Icon name="Play" className="size-3.5" />
            )}
            {purpose === "setup" ? "Rerun" : "Start"}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!activeSession && !controller.isCreateTerminalPending ? (
          <div className="flex h-full items-center justify-center px-5 text-center text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ThreadTerminalContent controller={controller} />
        )}
      </div>
    </section>
  );
}
