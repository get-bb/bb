import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentRuntimeBridgeLaunch,
  AgentRuntimeSkillRoot,
} from "@bb/agent-runtime";
import { flattenPromptInputGroups } from "@bb/domain";
import { killProcessesWithCwdUnder } from "@bb/process-utils";
import {
  STALE_TURN_ERROR_CODE,
  STEER_UNCONFIRMED_ERROR_CODE,
  THREAD_BUSY_ERROR_CODE,
  TURN_REJECTED_ERROR_CODE,
  TURN_START_UNCONFIRMED_ERROR_CODE,
  type HostDaemonCommandResult,
} from "@bb/host-daemon-contract";
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
import {
  currentTurnSubmitTrace,
  markTurnSubmitTraceSpan,
} from "../turn-submit-trace.js";

type TurnSubmitCommand = CommandOf<"turn.submit">;
type ExistingThreadRuntimeCommand =
  | TurnSubmitCommand
  | CommandOf<"thread.goal.clear">;

const TURN_SUBMIT_ACTIVE_TURN_WAIT_MS = 5_000;
const TURN_SUBMIT_STEER_ATTEMPTS = 2;

export interface ThreadRuntimeTarget {
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  entry: RuntimeEntry;
  skillRoots: readonly AgentRuntimeSkillRoot[];
}

interface ResumeThreadRuntimeIfMissingArgs {
  command: ExistingThreadRuntimeCommand;
  target: ThreadRuntimeTarget;
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

export async function deleteThreadStorage(
  command: CommandOf<"thread.storage.delete">,
  options: CommandDispatchOptions,
): Promise<void> {
  const storagePath = requireContainedPath(
    options.threadStorageRootPath,
    path.join(options.threadStorageRootPath, command.threadId),
    "Thread storage path escapes the storage root",
  );
  await killProcessesWithCwdUnder({ directories: [storagePath] });
  await fs.rm(storagePath, { recursive: true, force: true });
}

type ThreadStartRuntimeCommand =
  | CommandOf<"thread.start">
  | CommandOf<"thread.rewind.prepare">;

interface RequireSupportedProviderCliArgs {
  command: ThreadStartRuntimeCommand;
  options: CommandDispatchOptions;
}


async function cleanupAfterPostStagingFailure(
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch {}
}

function isUnconfirmedSubmitError(error: unknown): boolean {
  return (
    error instanceof CommandDispatchError &&
    (error.code === STEER_UNCONFIRMED_ERROR_CODE ||
      error.code === TURN_START_UNCONFIRMED_ERROR_CODE)
  );
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
  await options.refreshShellEnv({ allowStale: true });
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
        checkUpdates: false,
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

async function resolveThreadRuntimeTarget(args: {
  bridgeLaunch: CommandOf<"thread.start">["bridgeLaunch"];
  environmentId: string;
  injectedSkillSources: CommandOf<"thread.start">["injectedSkillSources"];
  options: CommandDispatchOptions;
  threadId: string;
  workspaceContext: CommandOf<"thread.start">["workspaceContext"];
}): Promise<ThreadRuntimeTarget> {
  const bridgeLaunch = await resolveRuntimeBridgeLaunch(
    args.bridgeLaunch,
    args.options,
  );
  const entry = await requireResolvedWorkspaceForCommand({
    environmentId: args.environmentId,
    runtimeManager: args.options.runtimeManager,
    workspaceContext: args.workspaceContext,
  });
  const skillRoots = await args.options.runtimeManager.stageThreadSkillRoots({
    environmentId: args.environmentId,
    injectedSkillSources: args.injectedSkillSources,
    threadId: args.threadId,
    workspacePath: entry.path,
  });
  return { bridgeLaunch, entry, skillRoots };
}

async function resolveThreadStartRuntime(
  command: ThreadStartRuntimeCommand,
  options: CommandDispatchOptions,
): Promise<ThreadRuntimeTarget> {
  return resolveThreadRuntimeTarget({
    bridgeLaunch: command.bridgeLaunch,
    environmentId: command.environmentId,
    injectedSkillSources: command.injectedSkillSources,
    options,
    threadId: command.threadId,
    workspaceContext: command.workspaceContext,
  });
}

async function resumeThreadRuntimeIfMissing(
  args: ResumeThreadRuntimeIfMissingArgs,
): Promise<void> {
  const { command, target } = args;
  const { resumeContext } = command;
  if (target.entry.runtime.hasThread(command.threadId)) {
    return;
  }
  if (!resumeContext.providerThreadId) {
    throw new CommandDispatchError(
      "unknown_thread_runtime",
      `No provider thread id available for thread ${command.threadId}`,
    );
  }
  await target.entry.runtime.resumeThread({
    bridgeLaunch: target.bridgeLaunch,
    skillRoots: target.skillRoots,
    environmentId: command.environmentId,
    threadId: command.threadId,
    projectId: resumeContext.projectId,
    providerThreadId: resumeContext.providerThreadId,
    providerId: resumeContext.providerId,
    contributedEnv: resumeContext.contributedEnv,
    options: command.options,
    instructions: resumeContext.instructions,
    dynamicTools: resumeContext.dynamicTools,
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
    const { bridgeLaunch, entry, skillRoots } = await resolveThreadStartRuntime(
      command,
      options,
    );
    const result = await entry.runtime.startThread({
      bridgeLaunch,
      skillRoots,
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
  const { bridgeLaunch, entry, skillRoots } = await resolveThreadStartRuntime(
    command,
    options,
  );
  return entry.runtime.prepareThreadRewind({
    bridgeLaunch,
    skillRoots,
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
): Promise<ThreadRuntimeTarget> {
  const { resumeContext } = command;
  const target = await resolveThreadRuntimeTarget({
    bridgeLaunch: resumeContext.bridgeLaunch,
    environmentId: command.environmentId,
    injectedSkillSources: resumeContext.injectedSkillSources,
    options,
    threadId: command.threadId,
    workspaceContext: resumeContext.workspaceContext,
  });
  markTurnSubmitTraceSpan("skills.staged");

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
  await resumeThreadRuntimeIfMissing({ command, target });
  markTurnSubmitTraceSpan("runtime.ready");
  return target;
}

function throwTurnInputRefusal(refusal: {
  status: "busy" | "rejected";
  message: string;
}): never {
  if (refusal.status === "busy") {
    throw new ExpectedCommandDispatchError(
      THREAD_BUSY_ERROR_CODE,
      refusal.message,
    );
  }
  throw new ExpectedCommandDispatchError(
    TURN_REJECTED_ERROR_CODE,
    refusal.message,
  );
}

async function runSubmittedTurn(
  command: TurnSubmitCommand,
  target: ThreadRuntimeTarget,
): Promise<void> {
  const { resumeContext } = command;
  const result = await target.entry.runtime.runTurn({
    threadId: command.threadId,
    input: command.input,
    clientRequestId: command.requestId,
    options: command.options,
    contributedEnv: resumeContext.contributedEnv,
    instructions: resumeContext.instructions,
    instructionMode: resumeContext.instructionMode,
    dynamicTools: resumeContext.dynamicTools,
    skillRoots: target.skillRoots,
    bridgeLaunch: target.bridgeLaunch,
  });
  if (result.status === "unconfirmed") {
    throw new CommandDispatchError(
      TURN_START_UNCONFIRMED_ERROR_CODE,
      `The agent did not confirm the turn start for thread ${command.threadId} before the request timed out`,
    );
  }
  if (result.status === "busy" || result.status === "rejected") {
    return throwTurnInputRefusal(result);
  }
}

async function steerSubmittedTurn(
  command: TurnSubmitCommand,
  target: ThreadRuntimeTarget,
  expectedTurnId: string,
): Promise<void> {
  const { entry } = target;
  let targetTurnId = expectedTurnId;
  let activeTurnId: string | null = null;
  for (let attempt = 0; attempt < TURN_SUBMIT_STEER_ATTEMPTS; attempt += 1) {
    const result = await entry.runtime.steerTurn({
      threadId: command.threadId,
      expectedTurnId: targetTurnId,
      input: command.input,
      clientRequestId: command.requestId,
      options: command.options,
    });

    if (result.status === "steered") {
      return;
    }
    if (result.status === "busy" || result.status === "rejected") {
      return throwTurnInputRefusal(result);
    }
    if (result.status === "unconfirmed") {
      throw new CommandDispatchError(
        STEER_UNCONFIRMED_ERROR_CODE,
        `The agent did not confirm the steer for turn ${targetTurnId} before the request timed out`,
      );
    }
    activeTurnId = result.activeTurnId;
    if (attempt === TURN_SUBMIT_STEER_ATTEMPTS - 1) {
      break;
    }
    const liveTurnId = await resolveLiveSubmittedTurnTarget(command, entry);
    if (liveTurnId === null) {
      return runSubmittedTurn(command, target);
    }
    if (liveTurnId === targetTurnId) {
      break;
    }
    targetTurnId = liveTurnId;
  }

  throw new CommandDispatchError(
    STALE_TURN_ERROR_CODE,
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
    throw new ExpectedCommandDispatchError(
      THREAD_BUSY_ERROR_CODE,
      `Thread ${command.threadId} is still starting a turn`,
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

async function deliverSubmittedTurn(
  command: TurnSubmitCommand,
  target: ThreadRuntimeTarget,
): Promise<void> {
  const resolvedTurnId = await resolveSubmittedTurnTarget(
    command,
    target.entry,
  );
  if (command.target.mode === "start" || resolvedTurnId === null) {
    return runSubmittedTurn(command, target);
  }
  return steerSubmittedTurn(command, target, resolvedTurnId);
}

export async function submitTurn(
  command: TurnSubmitCommand,
  target: ThreadRuntimeTarget,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"turn.submit">> {
  const staged = await stageThreadCommandInput({
    command,
    fetchProjectAttachment: options.fetchProjectAttachment,
    projectId: command.resumeContext.projectId,
    threadStorageRootPath: options.threadStorageRootPath,
  });
  markTurnSubmitTraceSpan("input.staged");
  const stagedCommand = {
    ...command,
    input: staged.input,
  };
  try {
    await resumeThreadRuntimeIfMissing({
      command: stagedCommand,
      target,
    });
    await deliverSubmittedTurn(stagedCommand, target);
  } catch (error) {
    if (!isUnconfirmedSubmitError(error)) {
      await cleanupAfterPostStagingFailure(staged.cleanup);
    }
    throw error;
  }
  markTurnSubmitTraceSpan("bridge.turnStarted");
  return { trace: currentTurnSubmitTrace() };
}
