import fs from "node:fs/promises";
import type { PromptInput } from "@bb/domain";
import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import { resolveContainedPath } from "@bb/process-utils";
import type { RuntimeEntry } from "../runtime-manager.js";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  stagePromptAttachmentGroups,
  stagePromptAttachments,
} from "./prompt-attachments.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";
import { getProviderCliStatusForProvider } from "../provider-cli-health.js";

type TurnSubmitCommand = CommandOf<"turn.submit">;

interface ResumeThreadRuntimeIfMissingArgs {
  command: TurnSubmitCommand;
  entry: RuntimeEntry;
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
  inputGroups?: TurnSubmitCommand["inputGroups"];
}

interface RequireSupportedProviderCliArgs {
  command: CommandOf<"thread.start">;
  options: CommandDispatchOptions;
}

function requireConfinedPath(rootPath: string, candidatePath: string): string {
  const resolved = resolveContainedPath({
    rootPath,
    candidatePath,
  });
  if (!resolved) {
    throw new CommandDispatchError(
      "invalid_path",
      "Thread storage path escapes the storage root",
    );
  }
  return resolved;
}

async function cleanupAfterPostStagingFailure(
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch {
    // Preserve the runtime/provisioning failure that triggered cleanup.
  }
}

async function cleanupStagedInputs(
  cleanups: readonly (() => Promise<void>)[],
): Promise<void> {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
}

function groupedInputForRuntime(
  inputGroups: readonly PromptInput[][],
): PromptInput[] {
  return inputGroups.flatMap((input, index) =>
    index === 0
      ? input
      : [{ type: "text" as const, text: "\n\n", mentions: [] }, ...input],
  );
}

async function requireSupportedProviderCliForThreadStart({
  command,
  options,
}: RequireSupportedProviderCliArgs): Promise<void> {
  if (command.providerId !== "codex") {
    return;
  }

  const status =
    (await options.getProviderCliStatusForProvider?.(command.providerId)) ??
    (await getProviderCliStatusForProvider("codex", {
      env: options.runtimeManager.getShellEnv(),
    }));
  if (!status.versionUnsupported) {
    return;
  }

  const currentVersion = status.currentVersion
    ? ` ${status.currentVersion}`
    : "";
  const minimumVersion = status.minimumSupportedVersion ?? "a newer version";
  throw new ExpectedCommandDispatchError(
    "provider_cli_unsupported_version",
    `Codex${currentVersion} is too old for this bb version. Update Codex to ${minimumVersion} or newer.`,
  );
}

async function stageThreadCommandInput(
  args: StageThreadCommandInputArgs,
): Promise<StagedThreadCommandInput> {
  const cleanups: (() => Promise<void>)[] = [];
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
      input: groupedInputForRuntime(stagedGroups.inputGroups),
      inputGroups: stagedGroups.inputGroups,
    };
  }

  const stagedInput = await stagePromptAttachments({
    fetchProjectAttachment: args.fetchProjectAttachment,
    input: args.command.input,
    projectId: args.projectId,
    requestId: args.command.requestId,
    threadStorageRootPath: args.threadStorageRootPath,
    threadId: args.command.threadId,
  });
  cleanups.push(stagedInput.cleanup);

  return {
    cleanup: () => cleanupStagedInputs(cleanups),
    input: stagedInput.input,
  };
}

async function resumeThreadRuntimeIfMissing(
  args: ResumeThreadRuntimeIfMissingArgs,
): Promise<void> {
  const { command, entry } = args;
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
  await entry.runtime.resumeThread({
    ...(command.resumeContext.acpLaunchSpec !== undefined
      ? { acpLaunchSpec: command.resumeContext.acpLaunchSpec }
      : command.acpLaunchSpec !== undefined
        ? { acpLaunchSpec: command.acpLaunchSpec }
        : {}),
    environmentId: command.environmentId,
    threadId: command.threadId,
    projectId: resumeContext.projectId,
    providerThreadId: resumeContext.providerThreadId,
    providerId: resumeContext.providerId,
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
    const confined = requireConfinedPath(
      options.threadStorageRootPath,
      command.threadStoragePath,
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
    const entry = await requireResolvedWorkspaceForCommand({
      dataDir: options.dataDir,
      environmentId: command.environmentId,
      injectedSkillSources: command.injectedSkillSources,
      runtimeManager: options.runtimeManager,
      targetThreadId: command.threadId,
      workspaceContext: command.workspaceContext,
    });
    const result = await entry.runtime.startThread({
      ...(command.acpLaunchSpec !== undefined
        ? { acpLaunchSpec: command.acpLaunchSpec }
        : {}),
      environmentId: command.environmentId,
      threadId: command.threadId,
      projectId: command.projectId,
      providerId: command.providerId,
      clientRequestId: command.requestId,
      input: staged.input,
      ...(staged.inputGroups !== undefined
        ? { inputGroups: staged.inputGroups }
        : {}),
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

export async function ensureThreadRuntime(
  command: TurnSubmitCommand,
  options: CommandDispatchOptions,
): Promise<RuntimeEntry> {
  const { resumeContext } = command;
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    injectedSkillSources: resumeContext.injectedSkillSources,
    runtimeManager: options.runtimeManager,
    targetThreadId: command.threadId,
    workspaceContext: resumeContext.workspaceContext,
  });

  await resumeThreadRuntimeIfMissing({ command, entry });
  return entry;
}

async function runSubmittedTurn(
  command: TurnSubmitCommand,
  entry: RuntimeEntry,
): Promise<HostDaemonCommandResult<"turn.submit">> {
  await entry.runtime.runTurn({
    threadId: command.threadId,
    input: command.input,
    ...(command.inputGroups !== undefined
      ? { inputGroups: command.inputGroups }
      : {}),
    clientRequestId: command.requestId,
    options: command.options,
    instructions: command.resumeContext.instructions,
  });
  return { appliedAs: "new-turn" };
}

async function steerSubmittedTurn(
  command: TurnSubmitCommand,
  entry: RuntimeEntry,
  expectedTurnId: string,
): Promise<HostDaemonCommandResult<"turn.submit">> {
  const result = await entry.runtime.steerTurn({
    threadId: command.threadId,
    expectedTurnId,
    input: command.input,
    ...(command.inputGroups !== undefined
      ? { inputGroups: command.inputGroups }
      : {}),
    clientRequestId: command.requestId,
    options: command.options,
    instructions: command.resumeContext.instructions,
  });

  if (result.status === "steered") {
    return { appliedAs: "steer" };
  }
  // A stale steer still represents a user send intent. If the target turn
  // ended before dispatch reached the daemon, preserve the message as a new turn.
  if (command.target.mode === "auto" || command.target.mode === "steer") {
    return runSubmittedTurn(command, entry);
  }

  throw new CommandDispatchError(
    "stale_turn",
    `Expected active turn ${expectedTurnId} for thread ${command.threadId}, but active turn is ${result.activeTurnId ?? "none"}`,
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
    ...(staged.inputGroups !== undefined
      ? { inputGroups: staged.inputGroups }
      : {}),
  };
  try {
    await resumeThreadRuntimeIfMissing({ command: stagedCommand, entry });
    switch (command.target.mode) {
      case "start":
        return await runSubmittedTurn(stagedCommand, entry);
      case "auto":
        return command.target.expectedTurnId
          ? await steerSubmittedTurn(
              stagedCommand,
              entry,
              command.target.expectedTurnId,
            )
          : await runSubmittedTurn(stagedCommand, entry);
      case "steer":
        if (!command.target.expectedTurnId) {
          // The server saw no active turn, but the user's intent is still "send".
          return await runSubmittedTurn(stagedCommand, entry);
        }
        return await steerSubmittedTurn(
          stagedCommand,
          entry,
          command.target.expectedTurnId,
        );
    }
  } catch (error) {
    await cleanupAfterPostStagingFailure(staged.cleanup);
    throw error;
  }
}
