import { desc, eq } from "drizzle-orm";
import {
  createThreadHandoff as createThreadHandoffRow,
  createThreadId,
  getThread,
  getThreadHandoffByReplacementThreadId,
  getThreadHandoffBySourceAndIdempotencyKey,
  markThreadHandoffFailed,
  noopNotifier,
  promptHistoryEntries,
  type ThreadHandoffRow,
} from "@bb/db";
import { promptInputSchema, type PromptInput, type Thread } from "@bb/domain";
import type {
  ThreadHandoffRequest,
  ThreadHandoffStatus,
} from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import {
  requireConnectedHostSession,
  requireEnvironment,
  requirePublicThread,
} from "../lib/entity-lookup.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import { emitPluginThreadCreated } from "../plugins/plugin-thread-events.js";
import { validateExplicitThreadExecution } from "../system/execution-options.js";
import { createThreadRecord } from "./thread-create-helpers.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "./thread-provisioning.js";

type ThreadHandoffDeps = LoggedPendingInteractionWorkSessionDeps;
const storedInputSchema = z.array(promptInputSchema).min(1);

function sourceLabel(thread: Thread): string {
  return (
    thread.title?.trim() ||
    thread.titleFallback?.trim() ||
    `Thread ${thread.id.slice(0, 8)}`
  );
}

function latestAcceptedAttachments(
  deps: Pick<ThreadHandoffDeps, "db">,
  threadId: string,
): PromptInput[] {
  const row = deps.db
    .select({ input: promptHistoryEntries.input })
    .from(promptHistoryEntries)
    .where(eq(promptHistoryEntries.threadId, threadId))
    .orderBy(
      desc(promptHistoryEntries.createdAt),
      desc(promptHistoryEntries.requestSequence),
      desc(promptHistoryEntries.id),
    )
    .limit(1)
    .get();
  if (!row) return [];
  const input = storedInputSchema.parse(JSON.parse(row.input));
  return input.filter(
    (item) =>
      item.type === "image" ||
      item.type === "localImage" ||
      item.type === "localFile",
  );
}

function buildHandoffInput(
  source: Thread,
  continuationText?: string,
): PromptInput[] {
  const prefix = "Continue from ";
  const mentionText = `@thread:${source.id}`;
  const firstLine = `${prefix}${mentionText}`;
  const text = continuationText
    ? `${firstLine}\n\n${continuationText}`
    : firstLine;
  return [
    {
      type: "text",
      text,
      mentions: [
        {
          start: prefix.length,
          end: firstLine.length,
          resource: {
            kind: "thread",
            projectId: source.projectId,
            threadId: source.id,
            label: sourceLabel(source),
          },
        },
      ],
    },
  ];
}

function toStatus(
  deps: Pick<ThreadHandoffDeps, "db">,
  handoff: ThreadHandoffRow,
): ThreadHandoffStatus {
  const source = getThread(deps.db, handoff.sourceThreadId);
  return {
    sourceThreadId: handoff.sourceThreadId,
    replacementThreadId: handoff.replacementThreadId,
    state: handoff.status,
    sourceArchived:
      source?.archivedAt !== null && source?.archivedAt !== undefined,
    failure:
      handoff.status === "failed"
        ? { code: handoff.failureCode!, message: handoff.failureMessage! }
        : null,
  };
}

export function getThreadHandoffStatus(
  deps: Pick<ThreadHandoffDeps, "db">,
  replacementThreadId: string,
): ThreadHandoffStatus {
  const handoff = getThreadHandoffByReplacementThreadId(
    deps.db,
    replacementThreadId,
  );
  if (!handoff) {
    throw new ApiError(
      404,
      "thread_handoff_not_found",
      "Thread handoff not found",
    );
  }
  return toStatus(deps, handoff);
}

function settleProvisioningFailure(
  deps: ThreadHandoffDeps,
  replacementThreadId: string,
  error: unknown,
): void {
  markThreadHandoffFailed(deps.db, {
    replacementThreadId,
    failure: {
      code: "thread_provisioning_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

function advanceHandoffProvisioning(
  deps: ThreadHandoffDeps,
  replacementThreadId: string,
  context: ReturnType<typeof requestThreadProvision>,
): void {
  void advanceThreadProvisioning(deps, {
    context,
    threadId: replacementThreadId,
    onThreadStartFailure: (error) => {
      settleProvisioningFailure(deps, replacementThreadId, error);
    },
  })
    .then(() => {
      const thread = getThread(deps.db, replacementThreadId);
      if (thread?.status === "error") {
        settleProvisioningFailure(
          deps,
          replacementThreadId,
          new Error("Replacement thread provisioning failed"),
        );
      }
    })
    .catch((error) => {
      settleProvisioningFailure(deps, replacementThreadId, error);
      deps.logger.warn(
        { replacementThreadId, ...runtimeErrorLogFields(deps.config, error) },
        "Failed to provision replacement thread",
      );
    });
}

export async function createThreadHandoff(
  deps: ThreadHandoffDeps,
  request: ThreadHandoffRequest,
): Promise<ThreadHandoffStatus> {
  const existing = getThreadHandoffBySourceAndIdempotencyKey(deps.db, request);
  if (existing) return toStatus(deps, existing);

  const source = requirePublicThread(deps.db, request.sourceThreadId);
  if (source.archivedAt !== null) {
    throw new ApiError(409, "thread_not_live", "Source thread is archived");
  }
  if (source.environmentId === null) {
    throw new ApiError(
      409,
      "thread_environment_unavailable",
      "Source thread has no environment",
    );
  }
  const environment = requireEnvironment(deps.db, source.environmentId);
  if (environment.projectId !== source.projectId) {
    throw new ApiError(
      409,
      "project_mismatch",
      "Source environment belongs to a different project",
    );
  }
  if (environment.status !== "ready" || !environment.path) {
    throwEnvironmentNotReady(environment);
  }
  requireConnectedHostSession(deps, environment.hostId);
  const execution = await validateExplicitThreadExecution(deps, {
    environmentId: environment.id,
    providerId: request.providerId,
    model: request.model,
    reasoningLevel: request.reasoningLevel,
    ...(request.serviceTier !== undefined
      ? { serviceTier: request.serviceTier }
      : {}),
    permissionMode: request.permissionMode,
  });
  const attachments = latestAcceptedAttachments(deps, source.id);
  await validatePromptAttachmentReferences({
    dataDir: deps.config.dataDir,
    projectId: source.projectId,
    input: attachments,
  });
  const input = [
    ...buildHandoffInput(source, request.continuationText),
    ...attachments,
  ];
  const replacementThreadId = createThreadId();
  const transactionResult = deps.db.transaction(
    (tx) => {
      const winner = getThreadHandoffBySourceAndIdempotencyKey(tx, request);
      if (winner)
        return { created: false as const, handoff: winner, thread: null };
      const thread = createThreadRecord(
        { db: tx, hub: noopNotifier },
        {
          id: replacementThreadId,
          emitPluginEvent: false,
          environmentId: environment.id,
          status: "starting",
          request: {
            environment: { type: "reuse", environmentId: environment.id },
            input,
            origin: request.origin,
            originKind: null,
            providerId: request.providerId,
            projectId: source.projectId,
            startedOnBehalfOf: null,
            titleFallback: null,
            visibility: "visible",
          },
        },
      );
      const created = createThreadHandoffRow(tx, {
        archiveSource: request.archiveSource,
        environmentId: environment.id,
        idempotencyKey: request.idempotencyKey,
        model: execution.model,
        permissionMode: execution.permissionMode,
        projectId: source.projectId,
        providerId: execution.providerId,
        reasoningLevel: execution.reasoningLevel,
        replacementThreadId: thread.id,
        serviceTier: execution.serviceTier,
        sourceThreadId: source.id,
      });
      if (!created.created)
        throw new Error("Handoff winner changed inside transaction");
      return { created: true as const, handoff: created.handoff, thread };
    },
    { behavior: "immediate" },
  );
  if (!transactionResult.created)
    return toStatus(deps, transactionResult.handoff);
  const replacement = transactionResult.thread;
  deps.hub.notifyThread(replacement.id, ["thread-created"], {
    projectId: replacement.projectId,
  });
  deps.hub.notifyProject(replacement.projectId, ["threads-changed"]);
  emitPluginThreadCreated(replacement);
  try {
    const context = requestThreadProvision(deps, {
      thread: replacement,
      environmentIntent: { type: "reuse", environmentId: environment.id },
      execution: {
        model: execution.model,
        reasoningLevel: execution.reasoningLevel,
        serviceTier: execution.serviceTier,
        permissionMode: execution.permissionMode,
        source: "client/turn/requested",
      },
      fork: null,
      input,
      startedOnBehalfOf: null,
      titleProvided: false,
    });
    advanceHandoffProvisioning(deps, replacement.id, context);
  } catch (error) {
    settleProvisioningFailure(deps, replacement.id, error);
  }
  return getThreadHandoffStatus(deps, replacement.id);
}
