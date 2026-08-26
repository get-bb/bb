import {
  getLastStoredTurnRequestEvent,
  getLatestStoredRateLimitsEventForProvider,
  getLatestStoredThreadEventOfTypes,
  getThread,
  type StoredThreadEventDataRow,
} from "@bb/db";
import {
  providerErrorInfoSchema,
  providerRateLimitStateSchema,
  type ClientTurnRequestId,
  type ProviderErrorInfo,
  type ProviderRateLimitState,
  type Thread,
  type TurnRequestEventData,
} from "@bb/domain";
import type { PluginTurnFailure } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AppDeps } from "../../types.js";
import { requirePublicProject } from "../lib/entity-lookup.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import {
  createThreadDispatchHold,
  listLiveThreadDispatchHolds,
  parseDispatchHoldPayload,
} from "./dispatch-holds.js";
import {
  dispatchGateEnvironmentAndHost,
  dispatchGateHolder,
  dispatchInputText,
  hasDispatchGates,
  runTurnFailedGatePass,
} from "./dispatch-gates.js";
import {
  currentPermissionMode,
  parseStoredTurnRequestEvent,
} from "./thread-events.js";
import { toThreadResponseFromThread } from "./thread-runtime-display.js";

export type TurnFailedGateDeps = Pick<
  AppDeps,
  "config" | "db" | "hub" | "logger" | "providerRegistry"
>;

/** The message shapes the fallback query can return, by event type. */
const failureMessageDataSchema = z.union([
  z.object({ error: z.object({ message: z.string() }).optional() }),
  z.object({ message: z.string() }),
]);

const providerErrorDataSchema = z.object({
  message: z.string(),
  errorInfo: providerErrorInfoSchema.optional(),
});

const rateLimitsDataSchema = z.object({
  rateLimits: providerRateLimitStateSchema,
});

function parseRowData(row: StoredThreadEventDataRow): unknown {
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function failureMessageFromRow(row: StoredThreadEventDataRow | null): string | null {
  if (row === null) return null;
  const parsed = failureMessageDataSchema.safeParse(parseRowData(row));
  if (!parsed.success) return null;
  if ("message" in parsed.data) return parsed.data.message;
  return parsed.data.error?.message ?? null;
}

interface FailedTurnRecord {
  request: TurnRequestEventData;
  requestSequence: number;
}

/**
 * The turn whose failure just landed: the most recent request on the thread.
 *
 * A failure applies at the moment the thread leaves `active`/`starting`, and
 * nothing else can have appended a request in between — the send path only
 * appends one while dispatching, and a queue drain waits for the thread to be
 * quiescent, which this failure is what makes it. Returns null for a thread
 * that has never dispatched a turn (a start that failed before any request),
 * where there is nothing for a retry to re-submit.
 */
function loadFailedTurn(
  deps: Pick<TurnFailedGateDeps, "db">,
  threadId: string,
): FailedTurnRecord | null {
  const row = getLastStoredTurnRequestEvent(deps.db, threadId);
  if (row === null) return null;
  try {
    return { request: parseStoredTurnRequestEvent(row), requestSequence: row.sequence };
  } catch {
    return null;
  }
}

/**
 * Which attempt just failed, and which request the chain started from.
 *
 * Both come off the failed request itself rather than a tally: the marker
 * written when a retry dispatched IS the counter, so restarts, re-holds and a
 * server that never saw the earlier attempts all arrive at the same number.
 */
function retryChain(request: TurnRequestEventData): {
  attemptNumber: number;
  originalRequestId: ClientTurnRequestId;
} {
  return {
    attemptNumber: request.retryAttempt ?? 1,
    originalRequestId: request.retryOfRequestId ?? request.requestId,
  };
}

function buildTurnFailure(
  deps: Pick<TurnFailedGateDeps, "db">,
  args: { failed: FailedTurnRecord; thread: Thread },
): PluginTurnFailure {
  const { failed, thread } = args;
  const providerErrorRow = getLatestStoredThreadEventOfTypes(deps.db, {
    threadId: thread.id,
    types: ["provider/error"],
    afterSequence: failed.requestSequence,
  });
  const providerError =
    providerErrorRow === null
      ? null
      : (providerErrorDataSchema.safeParse(parseRowData(providerErrorRow)).data ??
        null);
  // The provider's own account of the failure is the best message; the turn's
  // completion or a system error covers failures that never reached it.
  const fallbackRow =
    providerError === null
      ? getLatestStoredThreadEventOfTypes(deps.db, {
          threadId: thread.id,
          types: ["turn/completed", "system/error"],
          afterSequence: failed.requestSequence,
        })
      : null;
  const rateLimitsRow = getLatestStoredRateLimitsEventForProvider(deps.db, {
    threadId: thread.id,
    providerId: thread.providerId,
  });
  const rateLimits: ProviderRateLimitState | null =
    rateLimitsRow === null
      ? null
      : (rateLimitsDataSchema.safeParse(parseRowData(rateLimitsRow)).data
          ?.rateLimits ?? null);
  const errorInfo: ProviderErrorInfo | null = providerError?.errorInfo ?? null;
  const chain = retryChain(failed.request);
  return {
    requestId: failed.request.requestId,
    originalRequestId: chain.originalRequestId,
    turnId: providerErrorRow?.turnId ?? null,
    message:
      providerError?.message ??
      failureMessageFromRow(fallbackRow) ??
      "The turn failed.",
    errorInfo,
    rateLimits,
    attemptNumber: chain.attemptNumber,
  };
}

/**
 * True when this original request already has a live retry hold.
 *
 * `run.failed` applies once per failure, so this is not the common path — it is
 * the guard that keeps a duplicate or replayed failure from parking the same
 * turn twice, which the user would see as two identical retry cards.
 */
function hasLiveRetryHoldFor(
  deps: Pick<TurnFailedGateDeps, "db">,
  args: { threadId: string; originalRequestId: string },
): boolean {
  return listLiveThreadDispatchHolds(deps, args.threadId).some((hold) => {
    const payload = parseDispatchHoldPayload(hold);
    return (
      payload.kind === "retry" &&
      payload.retryOfTurnRequestId === args.originalRequestId
    );
  });
}

async function runTurnFailedGatesForThread(
  deps: TurnFailedGateDeps,
  threadId: string,
): Promise<void> {
  const thread = getThread(deps.db, threadId);
  if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
    return;
  }
  const failed = loadFailedTurn(deps, threadId);
  if (failed === null) {
    return;
  }
  const failure = buildTurnFailure(deps, { failed, thread });
  const { environment, host } = dispatchGateEnvironmentAndHost(
    deps,
    thread.environmentId,
  );
  const outcome = await runTurnFailedGatePass(deps, {
    threadId,
    context: {
      thread: toThreadResponseFromThread(deps, { thread }),
      project: requirePublicProject(deps.db, thread.projectId),
      environment,
      host,
      input: {
        blocks: [...failed.request.input],
        text: dispatchInputText(failed.request.input),
      },
      requestedExecution: {
        providerId: thread.providerId,
        model: failed.request.execution.model,
        reasoningLevel: failed.request.execution.reasoningLevel,
        serviceTier: failed.request.execution.serviceTier,
        permissionMode: currentPermissionMode(
          failed.request.execution.permissionMode,
        ),
      },
      origin: null,
      originPluginId: null,
      startedOnBehalfOf: null,
      parentThreadId: thread.parentThreadId,
      failure,
    },
  });
  if (outcome.kind === "none") {
    return;
  }
  if (
    hasLiveRetryHoldFor(deps, {
      threadId,
      originalRequestId: failure.originalRequestId,
    })
  ) {
    deps.logger.info(
      { threadId, pluginId: outcome.verdict.pluginId },
      "Ignored a turn.failed retry verdict: this turn already has a live retry hold",
    );
    return;
  }
  createThreadDispatchHold(deps, {
    threadId,
    environmentId: thread.environmentId,
    holder: dispatchGateHolder(outcome.verdict.pluginId),
    payload: {
      kind: "retry",
      retryOfTurnRequestId: failure.originalRequestId,
      attempt: failure.attemptNumber + 1,
    },
    reason: outcome.verdict.reason,
    resumeAt: outcome.verdict.resumeAt,
    userReleasable: true,
  });
  deps.hub.notifyThread(threadId, ["queue-changed"]);
}

/**
 * Serializes the pass per thread.
 *
 * Two failures on one thread are rare but not impossible (a command failure
 * settling as a turn completion arrives), and running their passes concurrently
 * would let both read "no live retry hold" and park the turn twice. Chaining
 * per thread rather than globally keeps one slow retry policy from delaying
 * every other thread's failure handling; the gate pass itself still takes the
 * server-wide evaluation lock.
 */
const passChainByThreadId = new Map<string, Promise<void>>();

function serializePerThread(
  threadId: string,
  run: () => Promise<void>,
): Promise<void> {
  const previous = passChainByThreadId.get(threadId) ?? Promise.resolve();
  const next = previous.then(run, run);
  const chain = next.then(
    () => undefined,
    () => undefined,
  );
  passChainByThreadId.set(threadId, chain);
  void chain.then(() => {
    if (passChainByThreadId.get(threadId) === chain) {
      passChainByThreadId.delete(threadId);
    }
  });
  return next;
}

export type TurnFailedGateNotifier = (threadId: string) => void;

/**
 * Module-level bridge from the lifecycle seam to the gate pass, mirroring
 * `plugin-thread-events.ts`: `lifecycle-outcome.ts` receives narrow
 * `{ db, hub, logger }` deps assembled long before the plugin service exists,
 * so createApp registers the one notifier here rather than threading full deps
 * through every caller. Unset (tests that never build an app) it is a no-op.
 */
let notifier: TurnFailedGateNotifier | undefined;

export function setTurnFailedGateNotifier(
  next: TurnFailedGateNotifier | undefined,
): void {
  notifier = next;
}

/**
 * Called after a `run.failed` lifecycle event is applied.
 *
 * Fire-and-forget on purpose: this stage observes a failure that has already
 * landed, so nothing about the thread's state depends on it, and the caller —
 * often mid-transaction — must not wait on plugin code.
 */
export function notifyThreadRunFailed(threadId: string): void {
  notifier?.(threadId);
}

/**
 * Builds the notifier createApp registers.
 *
 * The pass is deferred to the next macrotask because one of the two lifecycle
 * seams applies its event inside the caller's still-open transaction. Reading
 * the failed turn from there would see a half-written thread, and writing the
 * hold would nest a transaction inside it. Deferring also makes the "no gates
 * installed" path cost one boolean check on the failure path and nothing else.
 */
export function createTurnFailedGateNotifier(
  deps: TurnFailedGateDeps,
): TurnFailedGateNotifier {
  return (threadId) => {
    if (!hasDispatchGates("turn.failed")) {
      return;
    }
    const timer = setTimeout(() => {
      void serializePerThread(threadId, () =>
        runTurnFailedGatesForThread(deps, threadId),
      ).catch((error: unknown) => {
        deps.logger.warn(
          { threadId, ...runtimeErrorLogFields(deps.config, error) },
          "turn.failed gate pass failed; the thread's failure is unchanged",
        );
      });
    }, 0);
    timer.unref?.();
  };
}
