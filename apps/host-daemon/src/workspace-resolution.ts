import type {
  HostDaemonInjectedSkillSource,
  WorkspaceContext,
  WorkspaceResolutionFailure,
  WorkspaceResolutionFailureCode,
} from "@bb/host-daemon-contract";
import { workspaceResolutionFailureCodeSchema } from "@bb/host-daemon-contract";
import { WorkspaceError } from "@bb/host-workspace";
import type { RuntimeEntry, RuntimeManager } from "./runtime-manager.js";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
  requireWorkspaceEnvironment,
} from "./command-dispatch-support.js";

const WORKSPACE_RESOLUTION_FAILURE_CODES: readonly WorkspaceResolutionFailureCode[] =
  workspaceResolutionFailureCodeSchema.options;

interface BuildWorkspaceResolutionFailureArgs {
  code: WorkspaceResolutionFailureCode;
  message: string;
  workspacePath: string;
}

interface WorkspaceResolutionFailureFromErrorArgs {
  error: unknown;
  workspacePath: string;
}

interface ResolveWorkspaceForCommandArgs {
  dataDir?: string;
  environmentId: string;
  injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
  requireGit?: boolean;
  requireManagedWorktree?: boolean;
  runtimeManager: RuntimeManager;
  workspaceContext: WorkspaceContext;
}

type WorkspaceResolutionResult =
  | {
      ok: true;
      entry: RuntimeEntry;
    }
  | {
      ok: false;
      failure: WorkspaceResolutionFailure;
    };

interface PermissionDeniedError extends Error {
  readonly code: "EACCES" | "EPERM";
}

function isWorkspaceResolutionFailureCode(
  code: string,
): code is WorkspaceResolutionFailureCode {
  return WORKSPACE_RESOLUTION_FAILURE_CODES.some((value) => value === code);
}

function isPermissionDeniedError(
  error: unknown,
): error is PermissionDeniedError {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = Reflect.get(error, "code");
  return code === "EACCES" || code === "EPERM";
}

export function buildWorkspaceResolutionFailure(
  args: BuildWorkspaceResolutionFailureArgs,
): WorkspaceResolutionFailure {
  return {
    code: args.code,
    message: args.message,
    workspacePath: args.workspacePath,
  };
}

export function workspaceResolutionFailureFromError(
  args: WorkspaceResolutionFailureFromErrorArgs,
): WorkspaceResolutionFailure {
  const { error, workspacePath } = args;
  if (error instanceof WorkspaceError) {
    return buildWorkspaceResolutionFailure({
      code: isWorkspaceResolutionFailureCode(error.code)
        ? error.code
        : "unknown",
      message: error.message,
      workspacePath,
    });
  }
  if (error instanceof CommandDispatchError) {
    return buildWorkspaceResolutionFailure({
      code: isWorkspaceResolutionFailureCode(error.code)
        ? error.code
        : "unknown",
      message: error.message,
      workspacePath,
    });
  }
  if (isPermissionDeniedError(error)) {
    return buildWorkspaceResolutionFailure({
      code: "permission_denied",
      message: error.message,
      workspacePath,
    });
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return buildWorkspaceResolutionFailure({
      code: "unknown",
      message: error.message,
      workspacePath,
    });
  }
  return buildWorkspaceResolutionFailure({
    code: "unknown",
    message: "Unknown workspace resolution failure",
    workspacePath,
  });
}

export async function resolveWorkspaceForCommand(
  args: ResolveWorkspaceForCommandArgs,
): Promise<WorkspaceResolutionResult> {
  try {
    const entry = await requireWorkspaceEnvironment(
      {
        dataDir: args.dataDir,
        environmentId: args.environmentId,
        ...(args.injectedSkillSources !== undefined
          ? { injectedSkillSources: args.injectedSkillSources }
          : {}),
        workspaceContext: args.workspaceContext,
      },
      args.runtimeManager,
    );
    if (args.requireGit === true && !entry.workspace.isGitRepo) {
      return {
        ok: false,
        failure: buildWorkspaceResolutionFailure({
          code: "not_git_repo",
          message: `Path is not a git repository: ${entry.workspace.path}`,
          workspacePath: entry.workspace.path,
        }),
      };
    }
    if (
      args.requireManagedWorktree === true &&
      args.workspaceContext.workspaceProvisionType === "managed-worktree" &&
      !entry.workspace.isWorktree
    ) {
      return {
        ok: false,
        failure: buildWorkspaceResolutionFailure({
          code: "not_worktree",
          message: `Path is not a git worktree: ${entry.workspace.path}`,
          workspacePath: entry.workspace.path,
        }),
      };
    }
    return { ok: true, entry };
  } catch (error) {
    return {
      ok: false,
      failure: workspaceResolutionFailureFromError({
        error,
        workspacePath: args.workspaceContext.workspacePath,
      }),
    };
  }
}

export async function requireResolvedWorkspaceForCommand(
  args: ResolveWorkspaceForCommandArgs,
): Promise<RuntimeEntry> {
  const resolution = await resolveWorkspaceForCommand(args);
  if (resolution.ok) {
    return resolution.entry;
  }
  throw new ExpectedCommandDispatchError(
    resolution.failure.code,
    resolution.failure.message,
  );
}
