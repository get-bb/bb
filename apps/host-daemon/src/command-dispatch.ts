import type {
  HostDaemonCommand,
  HostDaemonCommandResult,
  HostDaemonSettledCommandType,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcCommandType,
  HostDaemonOnlineRpcResult,
  WorkspaceResolutionFailure,
} from "@bb/host-daemon-contract";
import type {
  ResolvedThreadExecutionOptions,
  RuntimeThreadExecutionOptions,
} from "@bb/domain";
import { listAvailableProviders } from "@bb/agent-runtime";
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
  deleteHostRelativeFile,
  deleteHostRelativePath,
  readHostFile,
  readHostFileMetadata,
  readHostRelativeFile,
  writeHostRelativeFile,
} from "./command-handlers/host-files.js";
import { resolveInteractiveRequest } from "./command-handlers/interactive.js";
import {
  getReplayCapture,
  listReplayCaptures,
  removeReplayCapture,
  runReplay,
} from "./command-handlers/replay.js";
import {
  completeCodexInference,
  transcribeCodexVoice,
} from "./codex-chatgpt-client.js";
import {
  ensureThreadRuntime,
  handleThreadDeleted,
  startThread,
  submitTurn,
} from "./command-handlers/thread.js";
import { WorkspaceError } from "@bb/host-workspace";
import {
  cancelWorkflowRun,
  listWorkflows,
  pruneWorkflowRun,
  resolveWorkflow,
  startWorkflowRun,
} from "./command-handlers/workflow.js";
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

function recordReplayThreadMetadata(
  command:
    | Extract<HostDaemonCommand, { type: "thread.start" }>
    | Extract<HostDaemonCommand, { type: "turn.submit" }>,
  options: CommandDispatchOptions,
): void {
  if (!options.recordReplayCaptureThreadMetadata) {
    return;
  }
  const runtimeContext =
    command.type === "thread.start" ? command : command.resumeContext;
  options.recordReplayCaptureThreadMetadata({
    environmentId: command.environmentId,
    projectId: runtimeContext.projectId,
    providerId: runtimeContext.providerId,
    threadId: command.threadId,
    title: null,
  });
}

/**
 * Translate runtime-shape execution options (which carry permissionEscalation
 * details and no source field) into the server-shape used by stored client
 * turn-request events, which is what the manifest persists for replay.
 */
function toReplayCaptureExecution(
  options: RuntimeThreadExecutionOptions,
): ResolvedThreadExecutionOptions {
  return {
    model: options.model,
    serviceTier: options.serviceTier,
    reasoningLevel: options.reasoningLevel,
    permissionMode: options.permissionMode,
    source: "client/turn/requested",
  };
}

function recordReplayTurnRequest(
  command:
    | Extract<HostDaemonCommand, { type: "thread.start" }>
    | Extract<HostDaemonCommand, { type: "turn.submit" }>,
  options: CommandDispatchOptions,
): void {
  if (!options.recordReplayCaptureTurnRequest) {
    return;
  }
  if (command.type === "thread.start") {
    options.recordReplayCaptureTurnRequest({
      threadId: command.threadId,
      kind: "thread-start",
      input: command.input,
      execution: toReplayCaptureExecution(command.options),
    });
    return;
  }
  // Only "start" guarantees a new turn (and thus a turn/started event that
  // consumes the buffered request). "auto" and "steer" may resolve to a steer
  // that emits no turn/started — leaving a stale request that would mislabel
  // a later capture. Skip them.
  if (command.target.mode !== "start") {
    return;
  }
  options.recordReplayCaptureTurnRequest({
    threadId: command.threadId,
    kind: "turn-start",
    input: command.input,
    execution: toReplayCaptureExecution(command.options),
  });
}

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
    recordReplayThreadMetadata(command, options);
    recordReplayTurnRequest(command, options);
    return startThread(command, options);
  },
  "turn.submit": async (command, options) => {
    recordReplayThreadMetadata(command, options);
    recordReplayTurnRequest(command, options);
    const entry = await ensureThreadRuntime(command, options);
    return submitTurn(command, entry, options);
  },
  "thread.stop": async (command, options) => {
    const replayTask = options.replayTasks?.get(command.threadId);
    if (replayTask) {
      replayTask.abort.abort();
      return {};
    }
    const entry = await requireExistingEnvironment(
      command.environmentId,
      options.runtimeManager,
    );
    if (
      options.runtimeManager.getThreadActiveTurnId({
        environmentId: command.environmentId,
        threadId: command.threadId,
      }) === null
    ) {
      await options.runtimeManager.waitForThreadActiveTurn({
        environmentId: command.environmentId,
        threadId: command.threadId,
        timeoutMs: THREAD_STOP_ACTIVE_TURN_WAIT_MS,
      });
    }
    await entry.runtime.stopThread({ threadId: command.threadId });
    // Stop completion finalizes server-side thread state. Flush provider
    // events first so buffered lifecycle events cannot arrive after that.
    await options.eventSink.flush();
    options.runtimeManager.forgetThread(
      command.environmentId,
      command.threadId,
    );
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
    options.runtimeManager.forgetThread(
      command.environmentId,
      command.threadId,
    );
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
  "thread.deleted": handleThreadDeleted,
  "interactive.resolve": resolveInteractiveRequest,
  "codex.inference.complete": completeCodexInference,
  "codex.voice.transcribe": transcribeCodexVoice,
  "host.write_file_relative": writeHostRelativeFile,
  "host.delete_file_relative": deleteHostRelativeFile,
  "host.delete_path_relative": deleteHostRelativePath,
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
  "workflow.start": startWorkflowRun,
  "workflow.cancel": cancelWorkflowRun,
};

const onlineRpcHandlers: OnlineRpcHandlerMap = {
  "development.replay": dispatchDevelopmentReplayCommand,
  "host.list_files": listHostFiles,
  "host.list_paths": listHostPaths,
  "host.list_commands": listHostCommands,
  "host.list_branches": listHostBranches,
  "host.file_metadata": readHostFileMetadata,
  "host.read_file": readHostFile,
  "host.read_file_relative": readHostRelativeFile,
  "provider.list": async (_command, options) => ({
    providers: (options.listProviders ?? listAvailableProviders)(),
  }),
  "provider.list_models": async (command, options) =>
    (options.listModels ?? defaultListModels)({
      providerId: command.providerId,
    }),
  "environment.cleanup_preflight": environmentCleanupPreflight,
  "workflow.list": listWorkflows,
  "workflow.prune": pruneWorkflowRun,
  "workflow.resolve": resolveWorkflow,
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

type DevelopmentReplayCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay" }
>;

export async function dispatchDevelopmentReplayCommand(
  command: DevelopmentReplayCommand,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"development.replay">> {
  try {
    switch (command.operation) {
      case "capture-list":
        return await listReplayCaptures(options);
      case "capture-get":
        return await getReplayCapture(command, options);
      case "capture-delete":
        return await removeReplayCapture(command, options);
      case "run":
        return await runReplay(command, options);
    }
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
