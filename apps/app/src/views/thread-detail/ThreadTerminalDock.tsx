import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type {
  ProjectRunCommandTarget,
  ProjectRunCommandTargetState,
  TerminalSession,
} from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { TabPill } from "@/components/ui/tab-pill";
import { cn } from "@/lib/utils";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { CHROME_ROW_CLASS } from "@/lib/bb-desktop";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "@/components/secondary-panel/panelChromeClasses";
import { terminalDockCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  getThreadTerminalDockStateId,
  useSetFixedSecondaryPanelOpen,
} from "@/lib/fixed-panel-tabs";
import {
  getRunCommandStateForTarget,
  isRunCommandStateActive,
} from "@/lib/project-run-command";
import { useProjectRunCommand } from "@/hooks/queries/sidebar-navigation-query";
import {
  useStartProjectRunCommand,
  useStopProjectRunCommand,
} from "@/hooks/mutations/project-mutations";
import {
  useEnvironmentTerminals,
  useTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { ThreadTerminalContent } from "@/components/thread/terminal/ThreadTerminalContent";
import { ThreadTerminalView } from "@/components/thread/terminal/ThreadTerminalView";
import {
  terminalStatusLabel,
  useThreadTerminalController,
} from "@/components/thread/terminal/useThreadTerminalController";

export interface ThreadTerminalDockProps {
  threadId: string;
  projectId: string | null;
  environmentId: string | null;
  isWorktreeEnvironment: boolean;
  /**
   * Whether the thread's environment has resolved. While a thread with an
   * environment is still loading, its worktree-ness is unknown, so the run
   * target must not fall back to project scope (it would mis-scope the Run tab).
   */
  isEnvironmentResolved: boolean;
  canCreateTerminal: boolean;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
}

type DockView = "run" | "terminal";

// Loads the threadless run-command session (env- or host-scoped) so the pinned
// Run tab can render its live terminal, mirroring how the compose page resolves
// a session by target + id.
function useRunCommandSession(
  runState: ProjectRunCommandTargetState | undefined,
  enabled: boolean,
): TerminalSession | null {
  const terminalTarget = runState?.terminalTarget ?? null;
  const isEnv = terminalTarget?.kind === "environment";
  const isHost = terminalTarget?.kind === "host_path";
  const environmentTerminalsQuery = useEnvironmentTerminals(
    isEnv ? terminalTarget.environmentId : "",
    { enabled: enabled && isEnv },
  );
  const hostTerminalsQuery = useTerminals(
    isHost
      ? {
          kind: "host_path",
          hostId: terminalTarget.hostId,
          ...(terminalTarget.cwd === null ? {} : { cwd: terminalTarget.cwd }),
        }
      : null,
    { enabled: enabled && isHost },
  );
  const sessions = isEnv
    ? environmentTerminalsQuery.data?.sessions
    : isHost
      ? hostTerminalsQuery.data?.sessions
      : undefined;
  const sessionId = runState?.terminalSessionId ?? null;
  if (sessionId === null || sessions === undefined) {
    return null;
  }
  return sessions.find((session) => session.id === sessionId) ?? null;
}

/**
 * The desktop terminal dock: a terminal-only recomposition of the right panel's
 * chrome that lives in the panel's bottom split. It owns its own tab strip
 * (add/close), a pinned non-closable Run tab surfacing the project run command,
 * and a single-active terminal body. Terminals ride an independent per-thread
 * fixed-panel-tabs store so the dock's active terminal is tracked separately
 * from the right panel's active content tab.
 */
export function ThreadTerminalDock({
  threadId,
  projectId,
  environmentId,
  isWorktreeEnvironment,
  isEnvironmentResolved,
  canCreateTerminal,
  onOpenLink,
  onSelectionAddToChat,
}: ThreadTerminalDockProps) {
  const dockStateId = getThreadTerminalDockStateId(threadId);
  const setDockOpen = useSetFixedSecondaryPanelOpen(dockStateId);
  const collapsed = useAtomValue(terminalDockCollapsedAtom);
  const setCollapsed = useSetAtom(terminalDockCollapsedAtom);
  // The controller gates its list query + attach + clean-terminal reaping on the
  // dock store's open flag; the dock is open exactly while expanded. Collapsing
  // then reaps untouched throwaway terminals, matching the right panel.
  useEffect(() => {
    setDockOpen(!collapsed);
  }, [collapsed, setDockOpen]);

  const controller = useThreadTerminalController({
    canCreateTerminal,
    panelStateId: dockStateId,
    target: { kind: "thread", threadId },
  });

  const { runCommand, states } = useProjectRunCommand(projectId);
  const runConfigured = (runCommand?.trim().length ?? 0) > 0;
  const runTarget = useMemo<ProjectRunCommandTarget | null>(() => {
    // A thread with an environment whose worktree-ness is not yet known must not
    // fall back to project scope; wait until it resolves to avoid a wrong-scope
    // Run tab that diverges from the sidebar.
    if (environmentId !== null && !isEnvironmentResolved) {
      return null;
    }
    if (environmentId !== null && isWorktreeEnvironment) {
      return { kind: "environment", environmentId };
    }
    return projectId !== null ? { kind: "project" } : null;
  }, [environmentId, isEnvironmentResolved, isWorktreeEnvironment, projectId]);
  const runState = runTarget
    ? getRunCommandStateForTarget(states, runTarget)
    : undefined;
  const showRunTab = runConfigured && runTarget !== null;
  const runActive = isRunCommandStateActive(runState);

  const [selectedView, setSelectedView] = useState<DockView>("run");
  // Keep an already-surfaced terminal in view: while the Run tab is unavailable
  // (e.g. run state still loading) and a terminal is active, hold "terminal" so
  // the Run tab's late arrival doesn't yank the user off it.
  useEffect(() => {
    if (!showRunTab && controller.activeTerminalId !== null) {
      setSelectedView("terminal");
    }
  }, [showRunTab, controller.activeTerminalId]);
  const activeView: DockView = showRunTab ? selectedView : "terminal";
  const runSession = useRunCommandSession(
    runState,
    activeView === "run" && showRunTab,
  );

  const startRunCommand = useStartProjectRunCommand();
  const stopRunCommand = useStopProjectRunCommand();
  const isRunCommandPending =
    startRunCommand.isPending || stopRunCommand.isPending;

  const handleToggleRunCommand = useCallback(() => {
    if (projectId === null || runTarget === null || isRunCommandPending) {
      return;
    }
    const request = { projectId, target: runTarget };
    if (runActive) {
      stopRunCommand.mutate(request);
      return;
    }
    startRunCommand.mutate(request, {
      onSuccess: () => setSelectedView("run"),
    });
  }, [
    isRunCommandPending,
    projectId,
    runActive,
    runTarget,
    startRunCommand,
    stopRunCommand,
  ]);

  const handleCreateTerminal = useCallback(() => {
    setSelectedView("terminal");
    controller.handleCreateTerminal();
  }, [controller]);

  const handleSelectTerminal = useCallback(
    (terminalId: string) => {
      setSelectedView("terminal");
      controller.handleSelectTerminal(terminalId);
    },
    [controller],
  );

  const runControlLabel = !runConfigured
    ? "Run command is not configured"
    : isRunCommandPending
      ? "Run command is updating"
      : runActive
        ? "Stop run command"
        : "Start run command";
  const runControlIcon = isRunCommandPending
    ? "Spinner"
    : runActive
      ? "Square"
      : "Play";

  return (
    <section
      aria-label="Terminal"
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <div className={SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS}>
        <div
          className={cn(CHROME_ROW_CLASS, "min-w-0 justify-between gap-2 px-4")}
        >
          <div
            className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            role="toolbar"
            aria-label="Terminal tabs"
          >
            {showRunTab ? (
              <TabPill
                label="Run"
                title="Project run command"
                leadingVisual={
                  <Icon name="Play" className="size-3.5" aria-hidden />
                }
                isActive={activeView === "run"}
                onSelect={() => setSelectedView("run")}
                closeAction={null}
              />
            ) : null}
            {controller.visibleSessions.map((session) => (
              <TabPill
                key={session.id}
                label={session.title}
                title={session.title}
                leadingVisual={
                  <Icon name="Terminal" className="size-3.5" aria-hidden />
                }
                secondaryLabel={
                  session.status === "running"
                    ? null
                    : `(${terminalStatusLabel(session)})`
                }
                isActive={
                  activeView === "terminal" &&
                  session.id === controller.activeTerminalId
                }
                onSelect={() => handleSelectTerminal(session.id)}
                labelMaxWidthClass="max-w-[160px]"
                closeAction={{
                  onClose: () => controller.handleCloseTerminal(session.id),
                  closeLabel: `Close ${session.title}`,
                  closeTooltip: "Close terminal",
                }}
              />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {showRunTab ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={!runConfigured || isRunCommandPending}
                onClick={handleToggleRunCommand}
                aria-label={runControlLabel}
              >
                <Icon
                  name={runControlIcon}
                  className={cn(
                    "size-3.5",
                    isRunCommandPending && "animate-spin",
                  )}
                />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              disabled={!canCreateTerminal}
              onClick={handleCreateTerminal}
              aria-label="New terminal"
            >
              <Icon name="Plus" className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse terminal dock"
            >
              <Icon name="ChevronDown" className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        {activeView === "run" && showRunTab ? (
          runSession ? (
            <ThreadTerminalView
              session={runSession}
              isPanelOpen={!collapsed}
              onOpenLink={onOpenLink}
              onSelectionAddToChat={onSelectionAddToChat}
            />
          ) : (
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
                    onClick={handleToggleRunCommand}
                  >
                    <Icon
                      name={isRunCommandPending ? "Spinner" : "Play"}
                      className={cn(
                        "size-3.5",
                        isRunCommandPending && "animate-spin",
                      )}
                    />
                    Start run command
                  </Button>
                </>
              )}
            </div>
          )
        ) : (
          <ThreadTerminalContent
            controller={controller}
            onOpenLink={onOpenLink}
            onSelectionAddToChat={onSelectionAddToChat}
          />
        )}
      </div>
    </section>
  );
}
