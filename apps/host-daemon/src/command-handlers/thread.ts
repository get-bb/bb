import fs from "node:fs/promises";
import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import { resolveContainedPath } from "@bb/process-utils";
import type { RuntimeEntry } from "../runtime-manager.js";
import {
  CommandDispatchError,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { stagePromptAttachments } from "./prompt-attachments.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";

type TurnSubmitCommand = CommandOf<"turn.submit">;

interface ResumeThreadRuntimeIfMissingArgs {
  command: TurnSubmitCommand;
  entry: RuntimeEntry;
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
  if (command.threadStoragePath) {
    const confined = requireConfinedPath(
      options.threadStorageRootPath,
      command.threadStoragePath,
    );
    await fs.mkdir(confined, { recursive: true });
  }
  const staged = await stagePromptAttachments({
    fetchProjectAttachment: options.fetchProjectAttachment,
    input: command.input,
    projectId: command.projectId,
    requestId: command.requestId,
    threadStorageRootPath: options.threadStorageRootPath,
    threadId: command.threadId,
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
      environmentId: command.environmentId,
      threadId: command.threadId,
      projectId: command.projectId,
      providerId: command.providerId,
      clientRequestId: command.requestId,
      input: staged.input,
      options: command.options,
      instructions: command.instructions,
      dynamicTools: command.dynamicTools,
      disallowedTools: command.disallowedTools,
      instructionMode: command.instructionMode,
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
  const staged = await stagePromptAttachments({
    fetchProjectAttachment: options.fetchProjectAttachment,
    input: command.input,
    projectId: command.resumeContext.projectId,
    requestId: command.requestId,
    threadStorageRootPath: options.threadStorageRootPath,
    threadId: command.threadId,
  });
  const stagedCommand = {
    ...command,
    input: staged.input,
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
