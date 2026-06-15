import type {
  HostDaemonCommand,
  HostDaemonCommandResult,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcCommandType,
  HostDaemonOnlineRpcResult,
  HostDaemonSettledCommandType,
  WorkspaceResolutionFailure,
} from "@bb/host-daemon-contract";
import {
  defaultListModels,
  ExpectedCommandDispatchError,
  requireExistingEnvironment,
  type CommandDispatchOptions,
  type CommandOf,
} from "./command-dispatch-support.js";
import {
  cancelEnvironmentProvision,
  provisionEnvironment,
} from "./command-handlers/environment.js";
import { listHostBranches } from "./command-handlers/host-branches.js";
import { listHostCommands } from "./command-handlers/list-commands.js";
import {
  listHostFiles,
  listHostPaths,
  readHostFile,
  readHostFileMetadata,
  readHostRelativeFile,
} from "./command-handlers/host-files.js";
import { resolveInteractiveRequest } from "./command-handlers/interactive.js";
import {
  completeCodexInference,
  transcribeCodexVoice,
} from "./codex-chatgpt-client.js";
import {
  ensureThreadRuntime,
  startThread,
  submitTurn,
} from "./command-handlers/thread.js";
import { WorkspaceError } from "@bb/host-workspace";
import { squashMerge } from "./command-handlers/workspace.js";
import {
  requireResolvedWorkspaceForCommand,
  resolveWorkspaceForCommand,
  workspaceResolutionFailureFromError,
} from "./workspace-resolution.js";

const THREAD_STOP_ACTIVE_TURN_WAIT_MS = 5_000;

export {
  CommandDispatchError,
  getErrorCode,
  noopEventSink,
  type CommandDispatchOptions,
} from "./command-dispatch-support.js";

type CommandHandlerMap = {
  [TType in HostDaemonSettledCommandType]: (
    command: Extract<HostDaemonCommand, { type: TType }>,
    options: CommandDispatchOptions,
  ) => Promise<HostDaemonCommandResult<TType>>;
};

type OnlineRpcHandlerMap = {
  [TType in HostDaemonOnlineRpcCommandType]: (
    command: Extract<HostDaemonOnlineRpcCommand, { type: TType }>,
    options: CommandDispatchOptions,
  ) => Promise<HostDaemonOnlineRpcResult<TType>>;
};

function throwExpectedWorkspacePathNotFoundOrRethrow(error: unknown): never {
  if (error instanceof WorkspaceError && error.code === "path_not_found") {
    throw new ExpectedCommandDispatchError(error.code, error.message);
  }
  throw error;
}

function cleanupPreflightFailureResult(
  failure: WorkspaceResolutionFailure,
): HostDaemonOnlineRpcResult<"environment.cleanup_preflight"> {
  if (failure.code === "path_not_found") {
    return { outcome: "already_missing", failure };
  }
  if (failure.code === "not_git_repo") {
    return { outcome: "not_inspectable", failure };
  }
  return { outcome: "probe_failed", failure };
}

async function environmentCleanupPreflight(
  command: CommandOf<"environment.cleanup_preflight">,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"environment.cleanup_preflight">> {
  const resolution = await resolveWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  if (!resolution.ok) {
    return cleanupPreflightFailureResult(resolution.failure);
  }

  const { entry } = resolution;
  if (!entry.workspace.isGitRepo) {
    return cleanupPreflightFailureResult({
      code: "not_git_repo",
      message: `Path is not a git repository: ${entry.workspace.path}`,
      workspacePath: entry.workspace.path,
    });
  }
  if (
    command.workspaceContext.workspaceProvisionType === "managed-worktree" &&
    !entry.workspace.isWorktree
  ) {
    return cleanupPreflightFailureResult({
      code: "not_worktree",
      message: `Path is not a git worktree: ${entry.workspace.path}`,
      workspacePath: entry.workspace.path,
    });
  }

  try {
    const workspaceStatus = await entry.workspace.getStatus({
      mergeBaseBranch: command.mergeBaseBranch,
    });
    if (
      workspaceStatus.workingTree.hasUncommittedChanges ||
      workspaceStatus.mergeBase?.hasCommittedUnmergedChanges === true
    ) {
      return {
        outcome: "blocked_by_changes",
        message: "Workspace has uncommitted or unmerged changes",
      };
    }
    return { outcome: "safe_to_destroy" };
  } catch (error) {
    const failure = workspaceResolutionFailureFromError({
      error,
      workspacePath: command.workspaceContext.workspacePath,
    });
    return cleanupPreflightFailureResult(failure);
  }
}

const commandHandlers: CommandHandlerMap = {
  "thread.start": async (command, options) => {
    return startThread(command, options);
  },
  "turn.submit": async (command, options) => {
    const entry = await ensureThreadRuntime(command, options);
    return submitTurn(command, entry, options);
  },
  "thread.stop": async (command, options) => {
    const entry = await requireExistingEnvironment(
      command.environmentId,
      options.runtimeManager,
    );
    if (entry.runtime.hasThread(command.threadId)) {
      // Stop can be dispatched while the start/submit RPC is still in flight
      // and the turn/started event has not been observed yet. Wait for the
      // runtime to learn the active turn (event-driven, resolves null on
      // timeout or when the thread goes idle) so the provider stop carries
      // the right turn id.
      await entry.runtime.waitForActiveTurn(command.threadId, {
        timeoutMs: THREAD_STOP_ACTIVE_TURN_WAIT_MS,
      });
      await entry.runtime.stopThread({ threadId: command.threadId });
    }
    // Stop completion finalizes server-side thread state. Flush provider
    // events first so buffered lifecycle events cannot arrive after that.
    await options.eventSink.flush();
    options.runtimeManager.forgetThread(command.threadId);
    return {};
  },
  "thread.rename": async (command, options) => {
    const entry = await options.runtimeManager.getOrAwait(
      command.environmentId,
    );
    if (!entry) {
      return {};
    }
    await entry.runtime.renameThread({
      threadId: command.threadId,
      title: command.title,
    });
    return {};
  },
  "thread.archive": async (command, options) => {
    const entry = await requireResolvedWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    await entry.runtime.archiveThread({
      threadId: command.threadId,
      providerId: command.providerId,
      providerThreadId: command.providerThreadId,
    });
    options.runtimeManager.forgetThread(command.threadId);
    return {};
  },
  "thread.unarchive": async (command, options) => {
    const runtime =
      await options.runtimeManager.ensureProviderMaintenanceRuntime({
        dataDir: options.dataDir,
      });
    await runtime.unarchiveThread({
      threadId: command.threadId,
      providerId: command.providerId,
      providerThreadId: command.providerThreadId,
    });
    return {};
  },
  "interactive.resolve": resolveInteractiveRequest,
  "codex.inference.complete": completeCodexInference,
  "codex.voice.transcribe": transcribeCodexVoice,
  "environment.provision": provisionEnvironment,
  "environment.provision.cancel": cancelEnvironmentProvision,
  "environment.destroy": async (command, options) => {
    const resolution = await resolveWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    if (!resolution.ok) {
      // Treat already-missing workspaces as successful destroy (idempotent retry).
      if (resolution.failure.code === "path_not_found") {
        return {};
      }
      throw new ExpectedCommandDispatchError(
        resolution.failure.code,
        resolution.failure.message,
      );
    }
    await options.terminalManager?.closeEnvironmentTerminals({
      environmentId: command.environmentId,
      reason: "environment-destroyed",
    });
    await options.runtimeManager.destroyEnvironment(command.environmentId);
    return {};
  },
  "workspace.commit": async (command, options) => {
    const entry = await requireResolvedWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    return entry.workspace.commit({
      message: command.message,
      noVerify: true,
    });
  },
  "workspace.squash_merge": squashMerge,
};

const onlineRpcHandlers: OnlineRpcHandlerMap = {
  "host.list_files": listHostFiles,
  "host.list_paths": listHostPaths,
  "host.list_commands": listHostCommands,
  "host.list_branches": listHostBranches,
  "host.file_metadata": readHostFileMetadata,
  "host.read_file": readHostFile,
  "host.read_file_relative": readHostRelativeFile,
  "provider.list_models": async (command, options) =>
    (options.listModels ?? defaultListModels)({
      providerId: command.providerId,
    }),
  "environment.cleanup_preflight": environmentCleanupPreflight,
  "workspace.status": async (command, options) => {
    const resolution = await resolveWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    if (!resolution.ok) {
      return { outcome: "unavailable", failure: resolution.failure };
    }
    try {
      return {
        outcome: "available",
        workspaceStatus: await resolution.entry.workspace.getStatus({
          mergeBaseBranch: command.mergeBaseBranch,
        }),
      };
    } catch (error) {
      return {
        outcome: "unavailable",
        failure: workspaceResolutionFailureFromError({
          error,
          workspacePath: command.workspaceContext.workspacePath,
        }),
      };
    }
  },
  "workspace.diff": async (command, options) => {
    const resolution = await resolveWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    if (!resolution.ok) {
      return { outcome: "unavailable", failure: resolution.failure };
    }
    try {
      return {
        outcome: "available",
        diff: await resolution.entry.workspace.getDiff({
          target: command.target,
          maxDiffBytes: command.maxDiffBytes,
          maxFileListBytes: command.maxFileListBytes,
        }),
      };
    } catch (error) {
      return {
        outcome: "unavailable",
        failure: workspaceResolutionFailureFromError({
          error,
          workspacePath: command.workspaceContext.workspacePath,
        }),
      };
    }
  },
  "workspace.pull_request": async (command, options) => {
    const resolution = await resolveWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    // Every failure mode collapses to "no PR": an unresolvable workspace, like
    // a missing `gh` or absent PR, just means there is nothing to show.
    if (!resolution.ok) {
      return { pullRequest: null };
    }
    return { pullRequest: await resolution.entry.workspace.getPullRequest() };
  },
};

export async function dispatchCommand<
  TType extends HostDaemonSettledCommandType,
>(
  command: Extract<HostDaemonCommand, { type: TType }>,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<TType>> {
  try {
    return await commandHandlers[command.type](command, options);
  } catch (error) {
    throwExpectedWorkspacePathNotFoundOrRethrow(error);
  }
}

export async function dispatchOnlineRpcCommand<
  TType extends HostDaemonOnlineRpcCommandType,
>(
  command: Extract<HostDaemonOnlineRpcCommand, { type: TType }>,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<TType>> {
  try {
    return await onlineRpcHandlers[command.type](command, options);
  } catch (error) {
    throwExpectedWorkspacePathNotFoundOrRethrow(error);
  }
}
