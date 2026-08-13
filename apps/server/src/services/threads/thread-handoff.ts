import { desc, eq } from "drizzle-orm";
import {
  areThreadHandoffArchiveEffectsCompleted,
  claimNextThreadHandoffArchiveEffect,
  completeClaimedThreadHandoffArchiveEffect,
  createThreadHandoffArchiveEffects,
  createThreadHandoff as createThreadHandoffRow,
  createThreadId,
  archiveThread,
  getThread,
  getThreadHandoffByReplacementThreadId,
  getThreadHandoffBySourceAndIdempotencyKey,
  hasNonStaleRootTurnStarted,
  markThreadHandoffFailed,
  markThreadHandoffStarted,
  noopNotifier,
  promptHistoryEntries,
  releaseClaimedThreadHandoffArchiveEffect,
  type ThreadHandoffRow,
  type SettleThreadHandoffResult,
  type ThreadHandoffArchiveEffectType,
} from "@bb/db";
import { promptInputSchema, type PromptInput, type Thread } from "@bb/domain";
import type {
  ThreadHandoffRequest,
  ThreadHandoffStatus,
} from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import {
  deliverBufferedDbNotification,
  NotificationBuffer,
  parseBufferedDbNotification,
} from "../lib/notification-buffer.js";
import {
  requireConnectedHostSession,
  requireEnvironment,
  requirePublicThread,
} from "../lib/entity-lookup.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import {
  emitPluginThreadArchived,
  emitPluginThreadCreated,
} from "../plugins/plugin-thread-events.js";
import { validateExplicitThreadExecution } from "../system/execution-options.js";
import { createThreadRecord } from "./thread-create-helpers.js";
import { applyThreadHandoffArchiveLifecycleEffect } from "./thread-archive.js";
import { releaseUnarchivedChildrenFromArchivedThreadInTransaction } from "./thread-ownership.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "./thread-provisioning.js";

type ThreadHandoffDeps = LoggedPendingInteractionWorkSessionDeps;
const storedInputSchema = z.array(promptInputSchema).min(1);
const archiveEffectSourceSchema = z.object({
  environmentId: z.string().min(1),
  threadId: z.string().min(1),
});
const ARCHIVE_EFFECT_CLAIM_LEASE_MS = 30_000;

export interface ThreadHandoffFailure {
  code: string;
  message: string;
}

function buildThreadHandoffArchiveEffects(
  notificationBuffer: NotificationBuffer,
  source: Thread,
) {
  if (!source.environmentId) {
    throw new Error("Archived handoff source has no environment");
  }
  const sourcePayload = JSON.stringify({
    environmentId: source.environmentId,
    threadId: source.id,
  });
  const lifecycleEffects: Array<{
    effectKey: string;
    effectType: ThreadHandoffArchiveEffectType;
    payload: string;
  }> = [
    {
      effectKey: "lifecycle:close-terminals",
      effectType: "close-terminals",
      payload: sourcePayload,
    },
    {
      effectKey: "lifecycle:stop-runtime",
      effectType: "stop-runtime",
      payload: sourcePayload,
    },
    {
      effectKey: "lifecycle:provider-archive",
      effectType: "provider-archive",
      payload: sourcePayload,
    },
    {
      effectKey: "lifecycle:reset-pruning",
      effectType: "reset-pruning",
      payload: sourcePayload,
    },
    {
      effectKey: "lifecycle:prune-events",
      effectType: "prune-events",
      payload: sourcePayload,
    },
    {
      effectKey: "plugin:archived",
      effectType: "plugin-archived",
      payload: sourcePayload,
    },
  ];
  return [
    ...notificationBuffer.snapshot().map((notification, index) => ({
      effectKey: `notification:${String(index).padStart(6, "0")}`,
      effectType: "notification" as const,
      payload: JSON.stringify(notification),
    })),
    ...lifecycleEffects,
  ];
}

function executeClaimedThreadHandoffArchiveEffect(
  deps: ThreadHandoffDeps,
  effect: NonNullable<ReturnType<typeof claimNextThreadHandoffArchiveEffect>>,
): void {
  if (effect.effectType === "notification") {
    deliverBufferedDbNotification(
      deps.hub,
      parseBufferedDbNotification(JSON.parse(effect.payload)),
    );
    return;
  }
  const payload = archiveEffectSourceSchema.parse(JSON.parse(effect.payload));
  const source = getThread(deps.db, payload.threadId);
  if (!source || source.archivedAt === null) {
    throw new Error("Thread handoff archive effect source is unavailable");
  }
  if (effect.effectType === "plugin-archived") {
    emitPluginThreadArchived(source);
    return;
  }
  const environment = requireEnvironment(deps.db, payload.environmentId);
  applyThreadHandoffArchiveLifecycleEffect(deps, {
    effectType: effect.effectType,
    environment,
    thread: source,
  });
}

export function retryThreadHandoffArchiveEffects(
  deps: ThreadHandoffDeps,
  replacementThreadId: string,
): boolean {
  const handoff = getThreadHandoffByReplacementThreadId(
    deps.db,
    replacementThreadId,
  );
  if (!handoff || handoff.status !== "started" || !handoff.archiveSource) {
    return true;
  }
  const failedEffectKeys = new Set<string>();
  while (true) {
    const effect = claimNextThreadHandoffArchiveEffect(deps.db, {
      excludeEffectKeys: [...failedEffectKeys],
      handoffId: handoff.id,
      leaseMs: ARCHIVE_EFFECT_CLAIM_LEASE_MS,
    });
    if (!effect) {
      return areThreadHandoffArchiveEffectsCompleted(deps.db, handoff.id);
    }
    const claimToken = effect.claimToken;
    if (!claimToken) {
      throw new Error("Claimed thread handoff archive effect has no token");
    }
    const completionArgs = {
      claimToken,
      effectKey: effect.effectKey,
      handoffId: effect.handoffId,
    };
    if (effect.effectType === "plugin-archived") {
      // Plugin events are observe-only and fire-and-forget. Complete before
      // dispatch for at-most-once behavior: a crash can lose this notification
      // but can never repeat arbitrary plugin handler side effects.
      if (!completeClaimedThreadHandoffArchiveEffect(deps.db, completionArgs)) {
        continue;
      }
      try {
        executeClaimedThreadHandoffArchiveEffect(deps, effect);
      } catch (error) {
        deps.logger.warn(
          { err: error, replacementThreadId },
          "At-most-once handoff plugin archive notification failed",
        );
      }
      continue;
    }
    try {
      executeClaimedThreadHandoffArchiveEffect(deps, effect);
      completeClaimedThreadHandoffArchiveEffect(deps.db, completionArgs);
    } catch (error) {
      releaseClaimedThreadHandoffArchiveEffect(deps.db, completionArgs);
      failedEffectKeys.add(effect.effectKey);
      deps.logger.warn(
        { err: error, replacementThreadId },
        "Thread handoff archive effect failed",
      );
      continue;
    }
  }
}

export function settleThreadHandoffStarted(
  deps: ThreadHandoffDeps,
  replacementThreadId: string,
): SettleThreadHandoffResult {
  const notificationBuffer = new NotificationBuffer();
  const transactionResult = deps.db.transaction(
    (tx) => {
      const outcome = markThreadHandoffStarted(tx, { replacementThreadId });
      if (!outcome.applied || !outcome.handoff.archiveSource) {
        return { archivedSource: null, outcome };
      }
      const source = getThread(tx, outcome.handoff.sourceThreadId);
      if (!source || source.archivedAt !== null) {
        return { archivedSource: null, outcome };
      }
      const archivedSource = archiveThread(tx, notificationBuffer, source.id);
      if (archivedSource) {
        releaseUnarchivedChildrenFromArchivedThreadInTransaction(
          { db: tx, hub: notificationBuffer },
          { parentThreadId: archivedSource.id },
        );
        createThreadHandoffArchiveEffects(tx, {
          effects: buildThreadHandoffArchiveEffects(
            notificationBuffer,
            archivedSource,
          ),
          handoffId: outcome.handoff.id,
        });
      }
      return { archivedSource, outcome };
    },
    { behavior: "immediate" },
  );
  const archivedSource = transactionResult.archivedSource;
  if (archivedSource) {
    retryThreadHandoffArchiveEffects(deps, replacementThreadId);
  }
  return transactionResult.outcome;
}

export function settleThreadHandoffFailed(
  deps: ThreadHandoffDeps,
  replacementThreadId: string,
  failure: ThreadHandoffFailure,
): SettleThreadHandoffResult {
  if (hasNonStaleRootTurnStarted(deps.db, replacementThreadId)) {
    return settleThreadHandoffStarted(deps, replacementThreadId);
  }
  return markThreadHandoffFailed(deps.db, {
    failure,
    replacementThreadId,
  });
}

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
  if (isCommandTimeoutError(error)) {
    return;
  }
  settleThreadHandoffFailed(deps, replacementThreadId, {
    code:
      error instanceof ApiError
        ? error.body.code
        : "thread_provisioning_failed",
    message:
      error instanceof ApiError
        ? error.body.message
        : error instanceof Error
          ? error.message
          : String(error),
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

function runPostCommitSideEffect(
  deps: ThreadHandoffDeps,
  replacementThreadId: string,
  label: string,
  effect: () => void,
): void {
  try {
    effect();
  } catch (error) {
    deps.logger.warn(
      { replacementThreadId, ...runtimeErrorLogFields(deps.config, error) },
      `Failed to ${label} for replacement thread`,
    );
  }
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
  runPostCommitSideEffect(
    deps,
    replacement.id,
    "notify thread creation",
    () => {
      deps.hub.notifyThread(replacement.id, ["thread-created"], {
        projectId: replacement.projectId,
      });
    },
  );
  runPostCommitSideEffect(deps, replacement.id, "notify project", () => {
    deps.hub.notifyProject(replacement.projectId, ["threads-changed"]);
  });
  runPostCommitSideEffect(deps, replacement.id, "emit plugin event", () => {
    emitPluginThreadCreated(replacement);
  });
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
