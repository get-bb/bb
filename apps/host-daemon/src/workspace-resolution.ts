import type {
  HostDaemonInjectedSkillSource,
  WorkspaceContext,
  WorkspaceResolutionFailure,
  WorkspaceResolutionFailureCode,
} from "@bb/host-daemon-contract";
import { workspaceResolutionFailureCodeSchema } from "@bb/host-daemon-contract";
import { getPersonalWorkspaceRoot, WorkspaceError } from "@bb/host-workspace";
import { z } from "zod";
import type { RuntimeEntry, RuntimeManager } from "./runtime-manager.js";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
  requireWorkspaceEnvironment,
} from "./command-dispatch-support.js";
import { reconnectProvisionArgsFromWorkspaceContext } from "./workspace-provision-target.js";

const WORKSPACE_RESOLUTION_FAILURE_CODES: readonly WorkspaceResolutionFailureCode[] =
  workspaceResolutionFailureCodeSchema.options;

interface WorkspaceResolutionFailureFromErrorArgs<TError> {
  error: TError;
  workspacePath: string;
}

interface WorkspaceEnvironmentRequest {
  dataDir?: string;
  environmentId: string;
  injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
  targetThreadId?: string;
  workspaceContext: WorkspaceContext;
}

interface ResolveWorkspaceForCommandArgs {
  dataDir?: string;
  environmentId: string;
  injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
  requireGit?: boolean;
  requireManagedWorktree?: boolean;
  runtimeManager: RuntimeManager;
  targetThreadId?: string;
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

interface PermissionDeniedError {
  readonly code: "EACCES" | "EPERM";
  readonly message: string;
}

const permissionDeniedErrorSchema = z
  .object({
    code: z.enum(["EACCES", "EPERM"]),
    message: z.string(),
  })
  .passthrough();

function isWorkspaceResolutionFailureCode(
  code: string,
): code is WorkspaceResolutionFailureCode {
  return WORKSPACE_RESOLUTION_FAILURE_CODES.some((value) => value === code);
}

function parsePermissionDeniedError<T>(error: T): PermissionDeniedError | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const parsed = permissionDeniedErrorSchema.safeParse(error);
  return parsed.success ? parsed.data : null;
}

export function workspaceResolutionFailureFromError<TError>(
  args: WorkspaceResolutionFailureFromErrorArgs<TError>,
): WorkspaceResolutionFailure {
  const { error, workspacePath } = args;
  if (error instanceof WorkspaceError) {
    return {
      code: isWorkspaceResolutionFailureCode(error.code)
        ? error.code
        : "unknown",
      message: error.message,
      workspacePath,
    };
  }
  if (error instanceof CommandDispatchError) {
    return {
      code: isWorkspaceResolutionFailureCode(error.code)
        ? error.code
        : "unknown",
      message: error.message,
      workspacePath,
    };
  }
  const permissionDeniedError = parsePermissionDeniedError(error);
  if (permissionDeniedError) {
    return {
      code: "permission_denied",
      message: permissionDeniedError.message,
      workspacePath,
    };
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return {
      code: "unknown",
      message: error.message,
      workspacePath,
    };
  }
  return {
    code: "unknown",
    message: "Unknown workspace resolution failure",
    workspacePath,
  };
}

export async function resolveWorkspaceForCommand(
  args: ResolveWorkspaceForCommandArgs,
): Promise<WorkspaceResolutionResult> {
  try {
    const workspaceRequest: WorkspaceEnvironmentRequest = {
      environmentId: args.environmentId,
      workspaceContext: args.workspaceContext,
    };
    if (args.dataDir !== undefined) workspaceRequest.dataDir = args.dataDir;
    if (args.injectedSkillSources !== undefined) {
      workspaceRequest.injectedSkillSources = args.injectedSkillSources;
    }
    if (args.targetThreadId !== undefined) {
      workspaceRequest.targetThreadId = args.targetThreadId;
    }
    const entry = await requireWorkspaceEnvironment(
      workspaceRequest,
      args.runtimeManager,
    );
    if (args.requireGit === true && !entry.workspace.isGitRepo) {
      const provisionRequest = {
        environmentId: args.environmentId,
        provision: reconnectProvisionArgsFromWorkspaceContext(
          args.dataDir
            ? {
                environmentId: args.environmentId,
                personalWorkspaceRoot: getPersonalWorkspaceRoot(args.dataDir),
                workspaceContext: args.workspaceContext,
              }
            : {
                environmentId: args.environmentId,
                workspaceContext: args.workspaceContext,
              },
        ),
        workspacePath: args.workspaceContext.workspacePath,
      };
      const workspace =
        await args.runtimeManager.refreshEnvironmentWorkspace(provisionRequest);
      if (!workspace.isGitRepo) {
        return {
          ok: false,
          failure: {
            code: "not_git_repo",
            message: `Path is not a git repository: ${entry.workspace.path}`,
            workspacePath: entry.workspace.path,
          },
        };
      }
    }
    if (
      args.requireManagedWorktree === true &&
      args.workspaceContext.workspaceProvisionType === "managed-worktree" &&
      !entry.workspace.isWorktree
    ) {
      return {
        ok: false,
        failure: {
          code: "not_worktree",
          message: `Path is not a git worktree: ${entry.workspace.path}`,
          workspacePath: entry.workspace.path,
        },
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
