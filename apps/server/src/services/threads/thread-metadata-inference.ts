import { getEnvironment, getThread } from "@bb/db";
import type { PromptInput, ProvisioningTranscriptEntry } from "@bb/domain";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { appendThreadProvisioningEvent } from "./thread-events.js";
import { dispatchThreadRenameCommand } from "./thread-commands.js";
import {
  applyGeneratedThreadTitle,
  generateThreadMetadataWithOutcome,
  type ThreadMetadataGenerationOutcome,
} from "./title-generation.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";

interface PendingThreadTitle {
  outcome: Promise<ThreadMetadataGenerationOutcome>;
  startedAt: number;
}

interface StartThreadTitleGenerationArgs {
  input: PromptInput[];
  threadId: string;
}

interface WaitForThreadTitleArgs {
  provisioningId: string;
  signal?: AbortSignal;
  threadId: string;
}

interface MetadataCompletedEntryArgs {
  outcome: ThreadMetadataGenerationOutcome;
  startedAt: number;
}

const pendingThreadTitles = new Map<string, PendingThreadTitle>();

function metadataCompletedEntry(
  args: MetadataCompletedEntryArgs,
): ProvisioningTranscriptEntry {
  const titleGenerated = Boolean(args.outcome.metadata?.title);
  return {
    type: "step",
    key: "metadata-completed",
    text: titleGenerated ? "Generated title" : "No title generated",
    status: "completed",
    startedAt: args.startedAt,
    metadata: {
      durationMs: args.outcome.durationMs,
      titleGenerated,
      ...(args.outcome.reason ? { reason: args.outcome.reason } : {}),
    },
  };
}

function applyTitle(
  deps: CommandResultSideEffectsDeps,
  threadId: string,
  title: string,
): boolean {
  try {
    return applyGeneratedThreadTitle(deps, { threadId, title });
  } catch (error) {
    deps.logger.warn(
      { threadId, ...runtimeErrorLogFields(deps.config, error) },
      "Failed to apply generated thread title",
    );
    return false;
  }
}

function renameStartedThread(
  deps: CommandResultSideEffectsDeps,
  threadId: string,
  title: string,
): void {
  try {
    const thread = getThread(deps.db, threadId);
    const environment = thread?.environmentId
      ? getEnvironment(deps.db, thread.environmentId)
      : null;
    if (
      !thread ||
      !environment ||
      (thread.status !== "active" && thread.status !== "idle")
    ) {
      return;
    }
    dispatchThreadRenameCommand(deps, {
      environment: { id: environment.id, hostId: environment.hostId },
      providerId: thread.providerId,
      threadId: thread.id,
      title,
    });
  } catch (error) {
    deps.logger.warn(
      { threadId, ...runtimeErrorLogFields(deps.config, error) },
      "Failed to rename the thread with its generated title",
    );
  }
}

async function generateThreadTitle(
  deps: CommandResultSideEffectsDeps,
  args: StartThreadTitleGenerationArgs & { startedAt: number },
): Promise<ThreadMetadataGenerationOutcome> {
  let outcome: ThreadMetadataGenerationOutcome;
  try {
    outcome = await generateThreadMetadataWithOutcome(deps, {
      input: args.input,
      threadId: args.threadId,
    });
  } catch (error) {
    deps.logger.warn(
      { threadId: args.threadId, ...runtimeErrorLogFields(deps.config, error) },
      "Failed to generate thread title",
    );
    return {
      durationMs: Date.now() - args.startedAt,
      metadata: null,
      reason: "failed",
    };
  }
  const title = outcome.metadata?.title;
  if (title && applyTitle(deps, args.threadId, title)) {
    renameStartedThread(deps, args.threadId, title);
  }
  return outcome;
}

export function startThreadTitleGeneration(
  deps: CommandResultSideEffectsDeps,
  args: StartThreadTitleGenerationArgs,
): void {
  if (pendingThreadTitles.has(args.threadId)) {
    return;
  }
  const startedAt = Date.now();
  const pending: PendingThreadTitle = {
    startedAt,
    outcome: generateThreadTitle(deps, { ...args, startedAt }).finally(() => {
      if (pendingThreadTitles.get(args.threadId) === pending) {
        pendingThreadTitles.delete(args.threadId);
      }
    }),
  };
  pendingThreadTitles.set(args.threadId, pending);
}

export function isThreadTitlePending(threadId: string): boolean {
  return pendingThreadTitles.has(threadId);
}

function outcomeUnlessAborted(
  outcome: Promise<ThreadMetadataGenerationOutcome>,
  signal: AbortSignal | undefined,
): Promise<ThreadMetadataGenerationOutcome | null> {
  if (signal === undefined) {
    return outcome;
  }
  if (signal.aborted) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const onAbort = (): void => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    void outcome.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    });
  });
}

export async function waitForThreadTitle(
  deps: LoggedWorkSessionDeps,
  args: WaitForThreadTitleArgs,
): Promise<void> {
  const pending = pendingThreadTitles.get(args.threadId);
  if (pending === undefined || args.signal?.aborted) {
    return;
  }
  appendThreadProvisioningEvent(deps, {
    threadId: args.threadId,
    environmentId: null,
    provisioningId: args.provisioningId,
    status: "active",
    entries: [
      {
        type: "step",
        key: "metadata-started",
        text: "Generating title",
        status: "started",
        startedAt: pending.startedAt,
      },
    ],
  });
  const outcome = await outcomeUnlessAborted(pending.outcome, args.signal);
  if (outcome === null) {
    return;
  }
  appendThreadProvisioningEvent(deps, {
    threadId: args.threadId,
    environmentId: null,
    provisioningId: args.provisioningId,
    status: "active",
    entries: [
      metadataCompletedEntry({ outcome, startedAt: pending.startedAt }),
    ],
  });
}
