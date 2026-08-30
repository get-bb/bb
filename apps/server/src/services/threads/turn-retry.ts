import { listQueuedThreadMessages } from "@bb/db";
import type { ClientTurnRequestId, Thread } from "@bb/domain";
import type { RetryTurnRequest, RetryTurnResponse } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { attemptDispatch } from "./dispatch-attempt.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";
import { loadFailedTurn, retryChain } from "./turn-failed.js";

type TurnRetryDeps = LoggedPendingInteractionWorkSessionDeps;

/**
 * True when this original request already has a queued retry row.
 *
 * One failure earns at most one live retry: a second row would re-submit the
 * same turn twice, which the user would see as two identical retry cards and
 * the provider as two identical turns.
 */
function hasQueuedRetryFor(
  deps: Pick<TurnRetryDeps, "db">,
  args: { threadId: string; originalRequestId: string },
): boolean {
  return listQueuedThreadMessages(deps.db, args.threadId).some((row) => {
    const payload = toThreadQueuedMessage(row).payload;
    return (
      payload.kind === "retry" &&
      payload.retryOfTurnRequestId === args.originalRequestId
    );
  });
}

/**
 * The failed turn a retry re-submits.
 *
 * A thread has exactly one retryable turn: its most recent one, whose failure
 * is what put it in `error`. Anything earlier has already been answered by the
 * turns after it, so re-submitting it would ask the provider to redo work the
 * conversation has moved past. `turnRequestId` therefore ASSERTS which turn the
 * caller means rather than selecting among several — it is how a retry policy
 * that decided on one failure refuses to act on a different one it never saw.
 */
function requireFailedTurn(
  deps: Pick<TurnRetryDeps, "db">,
  args: { thread: Thread; turnRequestId: ClientTurnRequestId | null },
) {
  const { thread } = args;
  if (thread.status !== "error") {
    throw new ApiError(
      409,
      "no_failed_turn",
      `Thread ${thread.id} has no failed turn to retry: it is ${thread.status}.`,
    );
  }
  const failed = loadFailedTurn(deps.db, thread.id);
  if (failed === null) {
    throw new ApiError(
      409,
      "no_failed_turn",
      `Thread ${thread.id} failed before it dispatched a turn, so there is nothing to retry.`,
    );
  }
  if (
    args.turnRequestId !== null &&
    args.turnRequestId !== failed.request.requestId
  ) {
    throw new ApiError(
      409,
      "no_failed_turn",
      `Turn ${args.turnRequestId} is not the failed turn on thread ${thread.id}; its most recent turn is ${failed.request.requestId}.`,
    );
  }
  return failed;
}

export interface RetryFailedTurnArgs {
  thread: Thread;
  request: RetryTurnRequest;
}

/**
 * Re-submits a failed turn.
 *
 * The retry is an ordinary dispatch attempt carrying a `retry` payload, which
 * is what makes it behave like everything else: a `sendAt` in the future queues
 * it on the clock, a busy thread queues it behind the running turn, and the
 * `message.dispatch` hook still gets to hold it — so a retry coming back after
 * a rate-limit window respects a limiter that is at capacity instead of jumping
 * the queue.
 *
 * The re-attempt carries the ORIGINAL blocks verbatim, so the provider is asked
 * the same question the failed attempt asked rather than being nudged with a
 * synthetic "please continue" whose meaning depends on what it remembers. Their
 * VISIBILITY is the one thing that changes: `agent-only` is what keeps the
 * timeline from showing the user's message a second time, using the same
 * projection rule that has always hidden system continuations. The user's
 * message stays where it was, on the attempt that failed.
 */
export async function retryFailedTurn(
  deps: TurnRetryDeps,
  args: RetryFailedTurnArgs,
): Promise<RetryTurnResponse> {
  const { request, thread } = args;
  const failed = requireFailedTurn(deps, {
    thread,
    turnRequestId: request.turnRequestId,
  });
  const chain = retryChain(failed.request);
  const originalRequestId = chain.originalRequestId;
  if (hasQueuedRetryFor(deps, { threadId: thread.id, originalRequestId })) {
    throw new ApiError(
      409,
      "retry_already_queued",
      `Turn ${originalRequestId} already has a retry waiting on thread ${thread.id}.`,
    );
  }
  const attempt = chain.attemptNumber + 1;
  const outcome = await attemptDispatch(deps, {
    thread,
    payload: {
      // A retry never steers: it re-runs a turn, so a thread that is busy again
      // is something to wait behind rather than to interrupt.
      mode: "queue-if-active",
      input: failed.request.input.map((block) => ({
        ...block,
        visibility: "agent-only" as const,
      })),
      ...(request.sendAt === null ? {} : { sendAt: request.sendAt }),
    },
    source: { kind: "inline" },
    queuePayload: {
      kind: "retry",
      retryOfTurnRequestId: originalRequestId,
      attempt,
      reason: request.reason,
    },
    retryOf: { requestId: originalRequestId, attempt },
    origin: null,
    originPluginId: null,
    startedOnBehalfOf: null,
    trigger: "user",
  });
  if (outcome.kind === "dispatched") {
    return {
      ok: true,
      delivery: "sent",
      turnRequestId: originalRequestId,
      attempt,
    };
  }
  return {
    ok: true,
    delivery: "queued",
    turnRequestId: originalRequestId,
    attempt,
    queuedMessageId: outcome.entry.id,
    // A queued row always has a wait; `waitingOn` is nullable on the DTO only
    // for rows written by the plain queue route before any attempt ran, which
    // are ordinary "behind the running turn" rows.
    waitingOn: outcome.entry.waitingOn ?? { kind: "thread-busy" },
    sendAt: outcome.entry.sendAt,
  };
}
