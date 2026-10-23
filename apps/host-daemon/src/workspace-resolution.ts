import type {
  HostDaemonInjectedSkillSource,
  WorkspaceContext,
} from "@bb/host-daemon-contract";
import type { RuntimeEntry, RuntimeManager } from "./runtime-manager.js";
import {
  ExpectedCommandDispatchError,
  requireWorkspaceEnvironment,
} from "./command-dispatch-support.js";
import {
  workspaceResolutionFailureFromError,
} from "bb-environment-provider-host/workspace-git";

interface ResolveWorkspaceForCommandArgs {
  environmentId: string;
  injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
  requireGit?: boolean;
  runtimeManager: RuntimeManager;
  targetThreadId?: string;
  workspaceContext: WorkspaceContext;
}

export async function requireResolvedWorkspaceForCommand(
  args: ResolveWorkspaceForCommandArgs,
): Promise<RuntimeEntry> {
  try {
    const entry = await requireWorkspaceEnvironment(
      {
        environmentId: args.environmentId,
        ...(args.injectedSkillSources !== undefined
          ? { injectedSkillSources: args.injectedSkillSources }
          : {}),
        ...(args.targetThreadId !== undefined
          ? { targetThreadId: args.targetThreadId }
          : {}),
        workspaceContext: args.workspaceContext,
      },
      args.runtimeManager,
    );
    if (args.requireGit === true && !entry.workspace.isGitRepo) {
      const workspace = await args.runtimeManager.refreshEnvironmentWorkspace({
        environmentId: args.environmentId,
        provision: { path: args.workspaceContext.workspacePath },
        workspacePath: args.workspaceContext.workspacePath,
      });
      if (!workspace.isGitRepo) {
        throw new ExpectedCommandDispatchError(
          "not_git_repo",
          `Path is not a git repository: ${entry.workspace.path}`,
        );
      }
    }
    return entry;
  } catch (error) {
    const failure = workspaceResolutionFailureFromError(
      error,
      args.workspaceContext.workspacePath,
    );
    throw new ExpectedCommandDispatchError(failure.code, failure.message);
  }
}
