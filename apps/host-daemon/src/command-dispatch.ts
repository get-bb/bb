import {
  providerCliInstallEventSchema,
  type ProviderCliInstallEvent,
  type ProviderCliStatus,
  HostDaemonCommand,
  HostDaemonCommandResult,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcCommandType,
  HostDaemonOnlineRpcResult,
  HostDaemonSettledCommandType,
} from "@bb/host-daemon-contract";
import semver from "semver";
import {
  CommandDispatchError,
  defaultListModels,
  ExpectedCommandDispatchError,
  type CommandOf,
  type CommandDispatchOptions,
} from "./command-dispatch-support.js";
import {
  cancelEnvironmentProvision,
  provisionEnvironment,
} from "./command-handlers/environment.js";
import {
  createCaffeinateManager,
  type CaffeinateManager,
} from "./command-handlers/caffeinate.js";
import { listHostBranches } from "./command-handlers/host-branches.js";
import {
  installGlobalSkills,
  readGlobalSkillsStatus,
} from "./command-handlers/install-global-skills.js";
import { listHostCommands } from "./command-handlers/list-commands.js";
import {
  deleteHostSkill,
  listHostSkills,
  writeHostSkill,
} from "./command-handlers/list-skills.js";
import {
  browseHostDirectory,
  checkHostPathsExist,
  listHostFiles,
  listHostPaths,
  readHostFile,
  readHostFileMetadata,
  readHostRelativeFile,
} from "./command-handlers/host-files.js";
import { writeHostFile } from "./command-handlers/file-write.js";
import {
  mkdirHostPath,
  moveHostPath,
  removeHostPath,
} from "./command-handlers/path-mutations.js";
import { resolveInteractiveRequest } from "./command-handlers/interactive.js";
import { pickHostFolder } from "./command-handlers/native-folder-picker.js";
import {
  completeCodexInference,
  transcribeCodexVoice,
} from "./codex-chatgpt-client.js";
import { discoverRepos } from "./command-handlers/discover-repos.js";
import { getProviderUsage } from "./provider-usage.js";
import {
  getKnownAcpAgentsStatus,
  getProviderCliStatus,
  getProviderCliStatusForProvider as inspectProviderCliStatusForProvider,
  ProviderCliInstallInProgressError,
  streamProviderCliInstall,
} from "./provider-cli-health.js";
import {
  discardThreadRewind,
  ensureThreadRuntime,
  prepareThreadRewind,
  startThread,
  submitTurn,
} from "./command-handlers/thread.js";
import { WorkspaceError } from "@bb/host-workspace";
import { squashMerge } from "./command-handlers/workspace.js";
import {
  cloneProject,
  inspectProjectPath,
  resolveProjectCloneDefaultPath,
} from "./command-handlers/project.js";
import {
  requireResolvedWorkspaceForCommand,
  resolveWorkspaceForCommand,
  workspaceResolutionFailureFromError,
} from "./workspace-resolution.js";

const THREAD_STOP_ACTIVE_TURN_WAIT_MS = 5_000;
const defaultCaffeinateManager = createCaffeinateManager();

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

function providerCliEnvFromShellEnv(
  shellEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return shellEnv.PATH ? { ...process.env, PATH: shellEnv.PATH } : process.env;
}

function getCaffeinateManager(
  options: CommandDispatchOptions,
): CaffeinateManager {
  return options.caffeinateManager ?? defaultCaffeinateManager;
}

function handleProviderCliInstallEventLine(
  line: string,
  events: ProviderCliInstallEvent[],
): void {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) {
    return;
  }
  events.push(providerCliInstallEventSchema.parse(JSON.parse(trimmedLine)));
}

function collectProviderCliInstallEventLines(
  buffer: string,
  events: ProviderCliInstallEvent[],
): string {
  const lines = buffer.split(/\r?\n/u);
  const lastLine = lines.pop();
  for (const line of lines) {
    handleProviderCliInstallEventLine(line, events);
  }
  return lastLine ?? "";
}

async function readProviderCliInstallEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<ProviderCliInstallEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: ProviderCliInstallEvent[] = [];
  let buffer = "";

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    buffer = collectProviderCliInstallEventLines(buffer, events);
  }

  buffer += decoder.decode();
  handleProviderCliInstallEventLine(buffer, events);
  return events;
}

async function tryGetProviderCliStatusForProvider(
  provider: CommandOf<"provider_cli.install">["provider"],
  options: CommandDispatchOptions,
  env: NodeJS.ProcessEnv,
): Promise<ProviderCliStatus | null> {
  try {
    if (options.getProviderCliStatusForProvider !== undefined) {
      return await options.getProviderCliStatusForProvider(provider);
    }
    return await inspectProviderCliStatusForProvider(provider, { env });
  } catch {
    return null;
  }
}

function verifyClaudeCodeUpdateEvents(args: {
  before: ProviderCliStatus;
  after: ProviderCliStatus | null;
  events: ProviderCliInstallEvent[];
}): ProviderCliInstallEvent[] {
  const completedIndex = args.events.findIndex(
    (event) => event.type === "completed" && event.success,
  );
  const expectedVersion = args.before.latestVersion;
  const previousVersion = args.before.currentVersion;
  const actualVersion = args.after?.currentVersion ?? null;
  if (completedIndex === -1) {
    return args.events;
  }

  const validExpectedVersion =
    expectedVersion === null ? null : semver.valid(expectedVersion);
  const validPreviousVersion =
    previousVersion === null ? null : semver.valid(previousVersion);
  const validActualVersion =
    actualVersion === null ? null : semver.valid(actualVersion);
  const hasKnownTarget = validExpectedVersion !== null;
  const canVerifyAdvancement =
    expectedVersion === null && validPreviousVersion !== null;
  if (!hasKnownTarget && !canVerifyAdvancement) {
    return args.events;
  }
  const updateVerified =
    validActualVersion !== null &&
    (validExpectedVersion !== null
      ? semver.gte(validActualVersion, validExpectedVersion)
      : validPreviousVersion !== null &&
        semver.gt(validActualVersion, validPreviousVersion));
  if (updateVerified) {
    return args.events;
  }

  const executable =
    args.after?.executablePath ??
    args.before.executablePath ??
    args.before.executableName;
  const expectation = hasKnownTarget
    ? `expected ${validExpectedVersion}`
    : `expected a version newer than ${validPreviousVersion}`;
  const message = `Claude Code's update command exited successfully, but ${executable} still reports ${actualVersion ?? "an unknown version"} (${expectation}). The executable may be pinned by PATH or managed by another installer. Run \`claude doctor\` on this machine and update the installation it reports.`;
  const verifiedEvents = [...args.events];
  const completedEvent = verifiedEvents[completedIndex];
  if (completedEvent?.type !== "completed") {
    return args.events;
  }
  verifiedEvents[completedIndex] = { ...completedEvent, success: false };
  verifiedEvents.splice(completedIndex, 0, {
    type: "error",
    provider: "claudeCode",
    message,
  });
  return verifiedEvents;
}

async function installProviderCliOnHost(
  command: CommandOf<"provider_cli.install">,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"provider_cli.install">> {
  try {
    const env = providerCliEnvFromShellEnv(
      options.runtimeManager.getShellEnv(),
    );
    const claudeCodeStatusBefore =
      command.provider === "claudeCode" && command.actionKind === "update"
        ? await tryGetProviderCliStatusForProvider(
            command.provider,
            options,
            env,
          )
        : null;
    const streamInstall =
      options.streamProviderCliInstall ?? streamProviderCliInstall;
    let events = await readProviderCliInstallEvents(
      streamInstall({
        provider: command.provider,
        actionKind: command.actionKind,
        env,
      }),
    );
    if (
      claudeCodeStatusBefore !== null &&
      events.some((event) => event.type === "completed" && event.success)
    ) {
      const claudeCodeStatusAfter = await tryGetProviderCliStatusForProvider(
        command.provider,
        options,
        env,
      );
      events = verifyClaudeCodeUpdateEvents({
        before: claudeCodeStatusBefore,
        after: claudeCodeStatusAfter,
        events,
      });
    }
    if (
      shouldInvalidateProviderMaintenanceRuntimeAfterProviderCliInstall({
        command,
        events,
      })
    ) {
      await options.runtimeManager.invalidateProviderMaintenanceRuntime();
    }
    return { events };
  } catch (error) {
    if (error instanceof ProviderCliInstallInProgressError) {
      return {
        events: [
          {
            type: "error",
            provider: command.provider,
            message: error.message,
          },
        ],
      };
    }
    throw error;
  }
}

function shouldInvalidateProviderMaintenanceRuntimeAfterProviderCliInstall(args: {
  command: CommandOf<"provider_cli.install">;
  events: readonly ProviderCliInstallEvent[];
}): boolean {
  return (
    // Codex model listing goes through the resident provider-maintenance
    // app-server, so a Codex CLI update can leave a stale model catalog alive.
    args.command.provider === "codex" &&
    args.events.some(
      (event) =>
        event.type === "completed" &&
        event.provider === args.command.provider &&
        event.success,
    )
  );
}

const commandHandlers: CommandHandlerMap = {
  "thread.rewind.discard": async (command, options) => {
    const release =
      await options.runtimeManager.retainEnvironmentForThreadCommand(
        command.environmentId,
        command.threadId,
      );
    try {
      return await discardThreadRewind(command, options);
    } finally {
      release();
    }
  },
  "thread.rewind.prepare": async (command, options) => {
    const release =
      await options.runtimeManager.retainEnvironmentForThreadCommand(
        command.environmentId,
        command.threadId,
      );
    try {
      return await prepareThreadRewind(command, options);
    } finally {
      release();
    }
  },
  "thread.start": async (command, options) => {
    const release =
      await options.runtimeManager.retainEnvironmentForThreadCommand(
        command.environmentId,
        command.threadId,
      );
    try {
      return await startThread(command, options);
    } finally {
      release();
    }
  },
  "turn.submit": async (command, options) => {
    const release =
      await options.runtimeManager.retainEnvironmentForThreadCommand(
        command.environmentId,
        command.threadId,
      );
    try {
      const entry = await ensureThreadRuntime(command, options);
      return await submitTurn(command, entry, options);
    } finally {
      release();
    }
  },
  "thread.stop": async (command, options) => {
    // Release before the target runtime lookup. A moved thread often has no
    // runtime in its new environment yet, and the old owner must still stop.
    const released =
      await options.runtimeManager.releaseThreadFromOtherEnvironments({
        activeTurn: "interrupt",
        environmentId: command.environmentId,
        threadId: command.threadId,
      });
    const entry = await options.runtimeManager.getOrAwait(
      command.environmentId,
    );
    if (!entry) {
      if (released.releasedEnvironmentIds.length === 0) {
        throw new CommandDispatchError(
          "unknown_environment",
          `No runtime exists for environment ${command.environmentId}`,
        );
      }
      // The old owner stopped, so the stop reached the running turn.
      await options.eventSink.flush();
      return {};
    }
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
    return {};
  },
  "thread.goal.clear": async (command, options) => {
    const entry = await ensureThreadRuntime(command, options);
    const result = await entry.runtime.clearThreadGoal({
      threadId: command.threadId,
    });
    await options.eventSink.flush();
    return result;
  },
  "thread.plan.cancel": async (command, options) => {
    // A moved thread keeps its turn in the environment it left, and the new
    // environment may hold no runtime yet. Cancel where the turn runs.
    const owners = options.runtimeManager.listThreadOwnerEntries(
      command.threadId,
    );
    if (owners.length === 0) {
      throw new ExpectedCommandDispatchError(
        "unknown_thread_runtime",
        `No provider runtime available for thread ${command.threadId}`,
      );
    }
    const owner = owners.find(
      (entry) =>
        entry.runtime.getActiveTurnId(command.threadId) ===
        command.expectedTurnId,
    );
    if (!owner) {
      return { cancelled: false };
    }
    await owner.runtime.stopThread({ threadId: command.threadId });
    await options.eventSink.flush();
    return { cancelled: true };
  },
  "thread.rename": async (command, options) => {
    const entry = await options.runtimeManager.getOrAwait(
      command.environmentId,
    );
    if (!entry) {
      return {};
    }
    // Rename does not move the provider session, so it must not stop a turn
    // that still runs in the environment the thread left.
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
    // Archive works on stored provider state, not on the live session, so it
    // must not stop a turn in the environment the thread left.
    await entry.runtime.archiveThread({
      threadId: command.threadId,
      providerId: command.providerId,
      providerThreadId: command.providerThreadId,
    });
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
  "project.clone": (command, options) =>
    cloneProject({
      dataDir: options.dataDir,
      projectSlug: command.projectSlug,
      remoteUrl: command.remoteUrl,
      ...(command.targetPath !== undefined
        ? { targetPath: command.targetPath }
        : {}),
    }),
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
  "workspace.pull_request_action": async (command, options) => {
    const entry = await requireResolvedWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      requireGit: true,
      requireManagedWorktree: true,
      runtimeManager: options.runtimeManager,
      workspaceContext: command.workspaceContext,
    });
    switch (command.operation) {
      case "ready":
        await entry.workspace.runPullRequestAction({ operation: "ready" });
        break;
      case "draft":
        await entry.workspace.runPullRequestAction({ operation: "draft" });
        break;
      case "merge":
        await entry.workspace.runPullRequestAction({
          operation: "merge",
          method: command.method,
        });
        break;
      default: {
        const _exhaustive: never = command;
        throw new Error(`Unhandled pull request operation: ${_exhaustive}`);
      }
    }
    return {};
  },
};

const onlineRpcHandlers: OnlineRpcHandlerMap = {
  "connect-tunnel.ensure-identity": async (_command, options) => {
    if (!options.ensureConnectTunnelIdentity) {
      throw new Error("bb connect tunnel identity is unavailable");
    }
    return options.ensureConnectTunnelIdentity();
  },
  "host.list_files": listHostFiles,
  "host.list_paths": listHostPaths,
  "host.mkdir": mkdirHostPath,
  "host.move_path": moveHostPath,
  "host.remove_path": removeHostPath,
  "host.browse_directory": browseHostDirectory,
  "host.paths_exist": checkHostPathsExist,
  "project.inspect": async (command) => inspectProjectPath(command.path),
  "project.clone_default_path": async (command, options) => ({
    path: resolveProjectCloneDefaultPath(options.dataDir, command.projectSlug),
  }),
  "host.pick_folder": pickHostFolder,
  "host.caffeinate": async (command, options) =>
    getCaffeinateManager(options).setEnabled(command.enabled),
  "host.list_commands": listHostCommands,
  "host.list_skills": listHostSkills,
  "host.delete_skill": deleteHostSkill,
  "host.write_skill": writeHostSkill,
  "host.install_global_skills": installGlobalSkills,
  "host.global_skills_status": async (command) =>
    readGlobalSkillsStatus(command, {}),
  "host.list_branches": listHostBranches,
  "host.file_metadata": readHostFileMetadata,
  "host.read_file": readHostFile,
  "host.read_file_relative": readHostRelativeFile,
  "host.write_file": writeHostFile,
  "provider.list_models": async (command, options) =>
    (options.listModels ?? defaultListModels)({
      providerId: command.providerId,
      ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
      ...(command.acpLaunchSpec !== undefined
        ? { acpLaunchSpec: command.acpLaunchSpec }
        : {}),
    }),
  "known_acp_agents.status": async (command) =>
    getKnownAcpAgentsStatus({ agents: command.agents }),
  "provider.usage": async () => getProviderUsage(),
  "provider_cli.status": async (_command, options) =>
    getProviderCliStatus({
      env: providerCliEnvFromShellEnv(options.runtimeManager.getShellEnv()),
    }),
  "provider_cli.install": installProviderCliOnHost,
  "workspace.discover_repos": async (command, options) =>
    discoverRepos({
      maxDepth: command.maxDepth,
      sinceDays: command.sinceDays,
      limit: command.limit,
      env: options.runtimeManager.getShellEnv(),
    }),
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
  "workspace.diffFiles": async (command, options) => {
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
        ...(await resolution.entry.workspace.diffFiles({
          target: command.target,
        })),
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
  "workspace.diffPatch": async (command, options) => {
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
        patches: await resolution.entry.workspace.diffPatch({
          target: command.target,
          paths: command.paths,
          maxBytesPerFile: command.maxBytesPerFile,
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
    // A non-git workspace genuinely has no PR; every other resolution failure
    // means the lookup cannot run, which must stay distinguishable from
    // "checked and found nothing".
    if (!resolution.ok) {
      return resolution.failure.code === "not_git_repo"
        ? { outcome: "absent" }
        : { outcome: "unavailable", message: resolution.failure.message };
    }
    const lookup = await resolution.entry.workspace.getPullRequest();
    switch (lookup.outcome) {
      case "found":
        return { outcome: "available", pullRequest: lookup.pullRequest };
      case "none":
        return { outcome: "absent" };
      case "unavailable":
        return { outcome: "unavailable", message: lookup.message };
    }
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
