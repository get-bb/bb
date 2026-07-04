import { useCallback, useMemo } from "react";
import type {
  ProjectRunCommandTarget,
  ProjectRunCommandTargetState,
  TerminalSession,
} from "@bb/server-contract";
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

interface UseThreadRunCommandTerminalArgs {
  projectId: string | null;
  environmentId: string | null;
  isWorktreeEnvironment: boolean;
  /**
   * Whether the thread's environment has resolved. While it is still loading its
   * worktree-ness is unknown, so the run target must not fall back to project
   * scope (that would mis-scope the Run tab and diverge from the sidebar).
   */
  isEnvironmentResolved: boolean;
  /** Load the threadless run session's terminal only when it is actually shown. */
  runTerminalEnabled: boolean;
}

export interface ThreadRunCommandTerminal {
  showRunTab: boolean;
  runConfigured: boolean;
  runActive: boolean;
  runState: ProjectRunCommandTargetState | undefined;
  runSession: TerminalSession | null;
  isRunCommandPending: boolean;
  onToggleRunCommand: () => void;
}

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
 * Resolves a thread's project run command into a pinned Run terminal: which
 * target it runs against, its live state/session, and start/stop. Shared by the
 * desktop terminal dock and the mobile drawer's pinned Run tab so both surface
 * the run identically.
 */
export function useThreadRunCommandTerminal({
  projectId,
  environmentId,
  isWorktreeEnvironment,
  isEnvironmentResolved,
  runTerminalEnabled,
}: UseThreadRunCommandTerminalArgs): ThreadRunCommandTerminal {
  const { runCommand, states } = useProjectRunCommand(projectId);
  const runConfigured = (runCommand?.trim().length ?? 0) > 0;
  const runTarget = useMemo<ProjectRunCommandTarget | null>(() => {
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
  const runSession = useRunCommandSession(
    runState,
    runTerminalEnabled && showRunTab,
  );

  const startRunCommand = useStartProjectRunCommand();
  const stopRunCommand = useStopProjectRunCommand();
  const isRunCommandPending =
    startRunCommand.isPending || stopRunCommand.isPending;
  const onToggleRunCommand = useCallback(() => {
    if (projectId === null || runTarget === null || isRunCommandPending) {
      return;
    }
    const request = { projectId, target: runTarget };
    if (runActive) {
      stopRunCommand.mutate(request);
    } else {
      startRunCommand.mutate(request);
    }
  }, [
    isRunCommandPending,
    projectId,
    runActive,
    runTarget,
    startRunCommand,
    stopRunCommand,
  ]);

  return {
    showRunTab,
    runConfigured,
    runActive,
    runState,
    runSession,
    isRunCommandPending,
    onToggleRunCommand,
  };
}
