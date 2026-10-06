import { getEnvironment, getThread } from "@bb/db";
import type { PromptInput, ProvisioningTranscriptEntry } from "@bb/domain";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { dispatchThreadRenameCommand } from "./thread-commands.js";
import { appendThreadProvisioningEvent } from "./thread-events.js";
import {
  applyGeneratedThreadTitle,
  generateThreadMetadataWithOutcome,
  type ThreadMetadataGenerationOutcome,
} from "./title-generation.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";

interface ThreadMetadataInferenceArgs {
  input: PromptInput[];
  provisioningId: string;
  threadId: string;
  writeTranscript: boolean;
}

const RETRY_TITLE_TIMEOUT_MS = 15_000;

interface MetadataCompletedEntryArgs {
  outcome: ThreadMetadataGenerationOutcome;
  startedAt: number;
}

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

function applyAndSyncGeneratedTitle(
  deps: CommandResultSideEffectsDeps,
  args: { threadId: string; title: string },
): void {
  let applied = false;
  try {
    applied = applyGeneratedThreadTitle(deps, args);
  } catch (error) {
    deps.logger.warn(
      {
        threadId: args.threadId,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to apply generated thread title",
    );
  }
  if (!applied) {
    return;
  }
  const thread = getThread(deps.db, args.threadId);
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
    title: args.title,
  });
}

async function retryThreadTitle(
  deps: CommandResultSideEffectsDeps,
  args: { input: PromptInput[]; threadId: string },
): Promise<void> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.title || thread.deletedAt !== null) {
    return;
  }
  const outcome = await generateThreadMetadataWithOutcome(deps, {
    input: args.input,
    threadId: args.threadId,
    timeoutMs: RETRY_TITLE_TIMEOUT_MS,
  });
  if (outcome.metadata?.title) {
    applyAndSyncGeneratedTitle(deps, {
      threadId: args.threadId,
      title: outcome.metadata.title,
    });
    return;
  }
  deps.logger.info(
    { threadId: args.threadId, reason: outcome.reason },
    "Thread title retry produced no title",
  );
}

export async function inferThreadMetadata(
  deps: CommandResultSideEffectsDeps,
  args: ThreadMetadataInferenceArgs,
): Promise<void> {
  const startedAt = Date.now();
  const provisioningId = args.provisioningId;
  if (args.writeTranscript) {
    appendThreadProvisioningEvent(deps, {
      threadId: args.threadId,
      environmentId: null,
      provisioningId,
      status: "active",
      entries: [
        {
          type: "step",
          key: "metadata-started",
          text: "Generating title",
          status: "started",
          startedAt,
        },
      ],
    });
  }

  const outcome = await generateThreadMetadataWithOutcome(deps, {
    input: args.input,
    threadId: args.threadId,
  });

  if (args.writeTranscript) {
    appendThreadProvisioningEvent(deps, {
      threadId: args.threadId,
      environmentId: null,
      provisioningId,
      status: "active",
      entries: [metadataCompletedEntry({ outcome, startedAt })],
    });
  }

  if (outcome.metadata?.title) {
    applyAndSyncGeneratedTitle(deps, {
      threadId: args.threadId,
      title: outcome.metadata.title,
    });
    return;
  }
  if (outcome.reason === "timeout" || outcome.reason === "failed") {
    void retryThreadTitle(deps, {
      input: args.input,
      threadId: args.threadId,
    }).catch((error) => {
      deps.logger.warn(
        {
          threadId: args.threadId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Failed to retry thread title generation",
      );
    });
  }
}
