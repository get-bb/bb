import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { TerminalSessionPurpose } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ThreadTerminalContent } from "@/components/thread/terminal/ThreadTerminalContent";
import { useThreadTerminalController } from "@/components/thread/terminal/useThreadTerminalController";
import { sdk } from "@/lib/sdk";
import { isLoopbackBrowserUrl } from "@/lib/browser-url";
import { getProjectSettingsScriptRoutePath } from "@/lib/route-paths";
import { useWorkspaceTerminalToolbarHost } from "../ThreadWorkspaceShell";

interface WorkspaceProcessTerminalProps {
  canCreateTerminal: boolean;
  command: string | null | undefined;
  environmentId: string;
  onOpenPreview: (url: string) => void;
  projectId: string;
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

export function formatLoopbackPreviewLabel(url: string): string {
  const parsed = new URL(url);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return `Open :${port}`;
}

export type WorkspaceProcessAction =
  | { kind: "none" }
  | { kind: "open"; label: string; url: string }
  | { kind: "start" };

export interface WorkspaceScriptConfigurationAction {
  href: string;
  label: "Add Run Script" | "Add Setup Script";
}

export function getWorkspaceScriptConfigurationAction({
  command,
  projectId,
  purpose,
}: {
  command: string | null | undefined;
  projectId: string;
  purpose: TerminalSessionPurpose;
}): WorkspaceScriptConfigurationAction | null {
  if (command !== null || (purpose !== "setup" && purpose !== "run")) {
    return null;
  }
  return {
    href: getProjectSettingsScriptRoutePath(projectId, purpose),
    label: purpose === "setup" ? "Add Setup Script" : "Add Run Script",
  };
}

export function getWorkspaceProcessAction({
  canCreateTerminal,
  isCreateTerminalPending,
  previewUrl,
  purpose,
  sessionStatus,
}: {
  canCreateTerminal: boolean;
  isCreateTerminalPending: boolean;
  previewUrl: string | null;
  purpose: TerminalSessionPurpose;
  sessionStatus: "starting" | "running" | "disconnected" | "exited" | null;
}): WorkspaceProcessAction {
  if (purpose === "run" && previewUrl !== null) {
    return {
      kind: "open",
      label: formatLoopbackPreviewLabel(previewUrl),
      url: previewUrl,
    };
  }
  if (
    isCreateTerminalPending ||
    sessionStatus === "starting" ||
    sessionStatus === "running" ||
    !canCreateTerminal
  ) {
    return { kind: "none" };
  }
  return { kind: "start" };
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
  projectId,
  purpose,
}: WorkspaceProcessTerminalProps) {
  const effectiveCommand = command;
  const title =
    purpose === "setup" ? "Setup" : purpose === "run" ? "Run" : "Terminal";
  const controller = useThreadTerminalController({
    canCreateTerminal:
      canCreateTerminal &&
      (purpose === "shell" ||
        (effectiveCommand !== null && effectiveCommand !== undefined)),
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
  const toolbarHost = useWorkspaceTerminalToolbarHost();
  const configurationAction = getWorkspaceScriptConfigurationAction({
    command: effectiveCommand,
    projectId,
    purpose,
  });

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

  const scriptSettingsUnavailable =
    effectiveCommand === undefined &&
    (purpose === "setup" || purpose === "run");
  let emptyMessage = "Start a terminal in this worktree.";
  if (scriptSettingsUnavailable) {
    emptyMessage = "Workspace script settings are unavailable.";
  } else if (configurationAction) {
    emptyMessage = `No ${title} script is configured for this project.`;
  } else if (purpose === "setup") {
    emptyMessage = "Start the Setup script for this worktree.";
  }

  const action = getWorkspaceProcessAction({
    canCreateTerminal: controller.canCreateTerminal,
    isCreateTerminalPending: controller.isCreateTerminalPending,
    previewUrl: activeSession?.status === "running" ? previewUrl : null,
    purpose,
    sessionStatus: activeSession?.status ?? null,
  });
  const toolbarAction =
    action.kind === "open" ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onOpenPreview(action.url)}
      >
        <Icon name="ArrowUpRight" className="size-3.5" />
        {action.label}
      </Button>
    ) : action.kind === "start" ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={controller.handleCreateTerminal}
      >
        <Icon name="Play" className="size-3.5" />
        Start
      </Button>
    ) : null;

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar"
      aria-label={`${title} terminal`}
    >
      {toolbarHost && toolbarAction
        ? createPortal(toolbarAction, toolbarHost)
        : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!activeSession && !controller.isCreateTerminalPending ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-xs text-muted-foreground">
            <p>{emptyMessage}</p>
            {configurationAction ? (
              <Button asChild variant="outline" size="sm">
                <Link to={configurationAction.href}>
                  <Icon name="Settings" className="size-3.5" />
                  {configurationAction.label}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <ThreadTerminalContent controller={controller} />
        )}
      </div>
    </section>
  );
}
