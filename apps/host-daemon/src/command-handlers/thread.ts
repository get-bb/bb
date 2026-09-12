import fs from "node:fs/promises";
import type { AgentRuntimeBridgeLaunch } from "@bb/agent-runtime";
import { flattenPromptInputGroups } from "@bb/domain";
import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import type { RuntimeEntry } from "../runtime-manager.js";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
  resolveRuntimeBridgeLaunch,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  requireContainedPath,
  stagePromptAttachmentGroups,
  stagePromptAttachments,
} from "./prompt-attachments.js";
import { providerInstallationGateKey } from "../provider-installation-gate.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";

type TurnSubmitCommand = CommandOf<"turn.submit">;
type ExistingThreadRuntimeCommand =
  | TurnSubmitCommand
  | CommandOf<"thread.goal.clear">;

const TURN_SUBMIT_ACTIVE_TURN_WAIT_MS = 5_000;
const TURN_SUBMIT_STEER_ATTEMPTS = 2;

interface ResumeThreadRuntimeIfMissingArgs {
  command: ExistingThreadRuntimeCommand;
  entry: RuntimeEntry;
  options: CommandDispatchOptions;
}

interface StageThreadCommandInputArgs {
  command: Pick<
    TurnSubmitCommand,
    "input" | "inputGroups" | "requestId" | "threadId"
  >;
  fetchProjectAttachment: CommandDispatchOptions["fetchProjectAttachment"];
  projectId: string;
  threadStorageRootPath: string;
}

interface StagedThreadCommandInput {
  cleanup: () => Promise<void>;
  input: TurnSubmitCommand["input"];
}

type ThreadStartRuntimeCommand =
  | CommandOf<"thread.start">
  | CommandOf<"thread.rewind.prepare">;

interface RequireSupportedProviderCliArgs {
  command: ThreadStartRuntimeCommand;
  options: CommandDispatchOptions;
}

interface ThreadStartRuntime {
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  entry: RuntimeEntry;
}

async function cleanupAfterPostStagingFailure(
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch {}
}

async function requireSupportedProviderCliForThreadStart({
  command,
  options,
}: RequireSupportedProviderCliArgs): Promise<void> {
  if (!command.bridgeLaunch.capabilities.providerInstallation) {
    return;
  }

  const requirement =
    command.type === "thread.rewind.prepare"
      ? ("thread_rewind" as const)
      : undefined;
  await options.refreshShellEnv();
  const status = await options.runtimeManager.providerInstallationGate.run(
    providerInstallationGateKey({
      providerId: command.providerId,
      bridgeLaunch: command.bridgeLaunch,
      requirement,
    }),
    async () => {
      const bridgeLaunch = await resolveRuntimeBridgeLaunch(
        command.bridgeLaunch,
        options,
      );
      return options.providerInstallationStatus({
        providerId: command.providerId,
        bridgeLaunch,
        ...(requirement !== undefined ? { requirement } : {}),
      });
    },
  );
  if (!status.versionUnsupported) {
    return;
  }

  const currentVersion = status.currentVersion
    ? ` ${status.currentVersion}`
    : "";
  const requiredVersion = status.minimumSupportedVersion ?? "a newer version";
  throw new ExpectedCommandDispatchError(
    "provider_cli_unsupported_version",
    `Provider "${command.providerId}"${currentVersion} is too old for this operation. Update it to ${requiredVersion} or newer.`,
  );
}

async function stageThreadCommandInput(
  args: StageThreadCommandInputArgs,
): Promise<StagedThreadCommandInput> {
  if (args.command.inputGroups !== undefined) {
    const stagedGroups = await stagePromptAttachmentGroups({
      fetchProjectAttachment: args.fetchProjectAttachment,
      inputGroups: args.command.inputGroups,
      projectId: args.projectId,
      requestId: args.command.requestId,
      threadStorageRootPath: args.threadStorageRootPath,
      threadId: args.command.threadId,
    });
    return {
      cleanup: stagedGroups.cleanup,
      input: flattenPromptInputGroups(stagedGroups.inputGroups),
    };
  }

  return stagePromptAttachments({
    fetchProjectAttachment: args.fetchProjectAttachment,
    input: args.command.input,
    projectId: args.projectId,
    requestId: args.command.requestId,
    threadStorageRootPath: args.threadStorageRootPath,
    threadId: args.command.threadId,
  });
}

async function resolveThreadStartRuntime(
  command: ThreadStartRuntimeCommand,
  options: CommandDispatchOptions,
): Promise<ThreadStartRuntime> {
  const bridgeLaunch = await resolveRuntimeBridgeLaunch(
    command.bridgeLaunch,
    options,
  );
  const entry = await requireResolvedWorkspaceForCommand({
    environmentId: command.environmentId,
    injectedSkillSources: command.injectedSkillSources,
    runtimeManager: options.runtimeManager,
    targetThreadId: command.threadId,
    workspaceContext: command.workspaceContext,
  });
  return { bridgeLaunch, entry };
}

async function resumeThreadRuntimeIfMissing(
  args: ResumeThreadRuntimeIfMissingArgs,
): Promise<void> {
  const { command, entry, options } = args;
  const { resumeContext } = command;
  if (entry.runtime.hasThread(command.threadId)) {
    return;
  }
  if (!resumeContext.providerThreadId) {
    throw new CommandDispatchError(
      "unknown_thread_runtime",
      `No provider thread id available for thread ${command.threadId}`,
    );
  }
  const bridgeLaunch = await resolveRuntimeBridgeLaunch(
    command.resumeContext.bridgeLaunch ?? command.bridgeLaunch,
    options,
  );
  await entry.runtime.resumeThread({
    bridgeLaunch,
    environmentId: command.environmentId,
    threadId: command.threadId,
    projectId: resumeContext.projectId,
    providerThreadId: resumeContext.providerThreadId,
    providerId: resumeContext.providerId,
    contributedEnv: resumeContext.contributedEnv,
    options: command.options,
    instructions: resumeContext.instructions,
    dynamicTools: resumeContext.dynamicTools,
    disallowedTools: resumeContext.disallowedTools,
    instructionMode: resumeContext.instructionMode,
  });
}

export async function startThread(
  command: CommandOf<"thread.start">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"thread.start">> {
  await requireSupportedProviderCliForThreadStart({ command, options });
  if (command.threadStoragePath) {
    const confined = requireContainedPath(
      options.threadStorageRootPath,
      command.threadStoragePath,
      "Thread storage path escapes the storage root",
    );
    await fs.mkdir(confined, { recursive: true });
  }
  const staged = await stageThreadCommandInput({
    command,
    fetchProjectAttachment: options.fetchProjectAttachment,
    projectId: command.projectId,
    threadStorageRootPath: options.threadStorageRootPath,
  });
  try {
    const { bridgeLaunch, entry } = await resolveThreadStartRuntime(
      command,
      options,
    );
    const result = await entry.runtime.startThread({
      bridgeLaunch,
      environmentId: command.environmentId,
      threadId: command.threadId,
      projectId: command.projectId,
      providerId: command.providerId,
      contributedEnv: command.contributedEnv,
      clientRequestId: command.requestId,
      input: staged.input,
      options: command.options,
      instructions: command.instructions,
      dynamicTools: command.dynamicTools,
      disallowedTools: command.disallowedTools,
      instructionMode: command.instructionMode,
      ...(command.fork ? { fork: command.fork } : {}),
    });
    return result;
  } catch (error) {
    await cleanupAfterPostStagingFailure(staged.cleanup);
    throw error;
  }
}

export async function prepareThreadRewind(
  command: CommandOf<"thread.rewind.prepare">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"thread.rewind.prepare">> {
  await requireSupportedProviderCliForThreadStart({ command, options });
  const { bridgeLaunch, entry } = await resolveThreadStartRuntime(
    command,
    options,
  );
  return entry.runtime.prepareThreadRewind({
    bridgeLaunch,
    environmentId: command.environmentId,
    threadId: command.threadId,
    leaseId: command.leaseId,
    projectId: command.projectId,
    providerId: command.providerId,
    contributedEnv: command.contributedEnv,
    sourceProviderThreadId: command.sourceProviderThreadId,
    retainThroughProviderCheckpoint: command.retainThroughProviderCheckpoint,
    options: command.options,
    instructions: command.instructions,
    dynamicTools: command.dynamicTools,
    disallowedTools: command.disallowedTools,
    instructionMode: command.instructionMode,
  });
}

export async function discardThreadRewind(
  command: CommandOf<"thread.rewind.discard">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"thread.rewind.discard">> {
  const entry = await options.runtimeManager.getOrAwait(command.environmentId);
  if (!entry) {
    return {};
  }
  await entry.runtime.discardThreadRewind({ leaseId: command.leaseId });
  return {};
}

export async function ensureThreadRuntime(
  command: ExistingThreadRuntimeCommand,
  options: CommandDispatchOptions,
): Promise<RuntimeEntry> {
  const { resumeContext } = command;
  const entry = await requireResolvedWorkspaceForCommand({
    environmentId: command.environmentId,
    injectedSkillSources: resumeContext.injectedSkillSources,
    runtimeManager: options.runtimeManager,
    targetThreadId: command.threadId,
    workspaceContext: resumeContext.workspaceContext,
  });

  const released =
    await options.runtimeManager.releaseThreadFromOtherEnvironments({
      activeTurn: command.type === "turn.submit" ? "interrupt" : "keep",
      environmentId: command.environmentId,
      threadId: command.threadId,
    });
  const [busyEnvironmentId] = released.activeTurnEnvironmentIds;
  if (busyEnvironmentId !== undefined) {
    throw new ExpectedCommandDispatchError(
      "thread_busy_in_other_environment",
      `Thread ${command.threadId} still runs a turn in environment ${busyEnvironmentId}`,
    );
  }
  await resumeThreadRuntimeIfMissing({ command, entry, options });
  return entry;
}

async function runSubmittedTurn(
  command: TurnSubmitCommand,
  entry: RuntimeEntry,
): Promise<HostDaemonCommandResult<"turn.submit">> {
  await entry.runtime.runTurn({
    threadId: command.threadId,
    input: command.input,
    clientRequestId: command.requestId,
    options: command.options,
    contributedEnv: command.resumeContext.contributedEnv,
    instructions: command.resumeContext.instructions,
  });
  return { appliedAs: "new-turn" };
}

async function steerSubmittedTurn(
  command: TurnSubmitCommand,
  entry: RuntimeEntry,
  expectedTurnId: string,
): Promise<HostDaemonCommandResult<"turn.submit">> {
  let targetTurnId = expectedTurnId;
  let activeTurnId: string | null = null;
  for (let attempt = 0; attempt < TURN_SUBMIT_STEER_ATTEMPTS; attempt += 1) {
    const result = await entry.runtime.steerTurn({
      threadId: command.threadId,
      expectedTurnId: targetTurnId,
      input: command.input,
      clientRequestId: command.requestId,
      options: command.options,
      contributedEnv: command.resumeContext.contributedEnv,
      instructions: command.resumeContext.instructions,
    });

    if (result.status === "steered") {
      return { appliedAs: "steer" };
    }
    activeTurnId = result.activeTurnId;
    if (attempt === TURN_SUBMIT_STEER_ATTEMPTS - 1) {
      break;
    }
    const liveTurnId = await resolveLiveSubmittedTurnTarget(command, entry);
    if (liveTurnId === null) {
      return runSubmittedTurn(command, entry);
    }
    if (liveTurnId === targetTurnId) {
      break;
    }
    targetTurnId = liveTurnId;
  }

  throw new CommandDispatchError(
    "stale_turn",
    `Expected active turn ${targetTurnId} for thread ${command.threadId}, but active turn is ${activeTurnId ?? "none"}`,
  );
}

async function resolveLiveSubmittedTurnTarget(
  command: TurnSubmitCommand,
  entry: RuntimeEntry,
): Promise<string | null> {
  const activeTurnId = entry.runtime.getActiveTurnId(command.threadId);
  if (activeTurnId !== null) {
    return activeTurnId;
  }
  if (!entry.runtime.getLiveThreadIds().includes(command.threadId)) {
    return null;
  }
  const awaitedTurnId = await entry.runtime.waitForActiveTurn(
    command.threadId,
    {
      timeoutMs: TURN_SUBMIT_ACTIVE_TURN_WAIT_MS,
    },
  );
  if (awaitedTurnId !== null) {
    return awaitedTurnId;
  }
  const refreshedTurnId = entry.runtime.getActiveTurnId(command.threadId);
  if (refreshedTurnId !== null) {
    return refreshedTurnId;
  }
  if (entry.runtime.getLiveThreadIds().includes(command.threadId)) {
    throw new Error(
      `Refusing to start a competing turn while ${command.threadId} is still starting`,
    );
  }
  return null;
}

async function resolveSubmittedTurnTarget(
  command: TurnSubmitCommand,
  entry: RuntimeEntry,
): Promise<string | null> {
  if (command.target.mode === "start") {
    return null;
  }
  if (
    command.target.mode === "steer" &&
    command.target.expectedTurnId !== null
  ) {
    return command.target.expectedTurnId;
  }
  return (
    (await resolveLiveSubmittedTurnTarget(command, entry)) ??
    command.target.expectedTurnId
  );
}

export async function submitTurn(
  command: TurnSubmitCommand,
  entry: RuntimeEntry,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"turn.submit">> {
  const staged = await stageThreadCommandInput({
    command,
    fetchProjectAttachment: options.fetchProjectAttachment,
    projectId: command.resumeContext.projectId,
    threadStorageRootPath: options.threadStorageRootPath,
  });
  const stagedCommand = {
    ...command,
    input: staged.input,
  };
  try {
    await resumeThreadRuntimeIfMissing({
      command: stagedCommand,
      entry,
      options,
    });
    const resolvedTurnId = await resolveSubmittedTurnTarget(
      stagedCommand,
      entry,
    );
    switch (command.target.mode) {
      case "start":
        return await runSubmittedTurn(stagedCommand, entry);
      case "auto":
        return resolvedTurnId
          ? await steerSubmittedTurn(stagedCommand, entry, resolvedTurnId)
          : await runSubmittedTurn(stagedCommand, entry);
      case "steer":
        if (!resolvedTurnId) {
          return await runSubmittedTurn(stagedCommand, entry);
        }
        return await steerSubmittedTurn(stagedCommand, entry, resolvedTurnId);
    }
  } catch (error) {
    await cleanupAfterPostStagingFailure(staged.cleanup);
    throw error;
  }
}
