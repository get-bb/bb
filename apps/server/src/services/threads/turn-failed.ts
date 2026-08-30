import {
  getLastStoredTurnRequestEvent,
  getLatestStoredRateLimitsEventForProvider,
  getLatestStoredThreadEventOfTypes,
  getThread,
  type DbConnection,
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
import type { PluginTurnFailedEvent } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { parseStoredTurnRequestEvent } from "./thread-events.js";

/** The message shapes the fallback query can return, by event type. */
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
 * where there is nothing to announce and nothing for a retry to re-submit.
 */
export function loadFailedTurn(
  db: DbConnection,
  threadId: string,
): FailedTurnRecord | null {
  const row = getLastStoredTurnRequestEvent(db, threadId);
  if (row === null) return null;
  try {
    return {
      request: parseStoredTurnRequestEvent(row),
      requestSequence: row.sequence,
    };
  } catch {
    return null;
  }
}

/**
 * Which attempt failed, and which request the chain started from.
 *
 * Both come off the failed request itself rather than a tally: the marker
 * written when a retry dispatched IS the counter, so restarts, re-queues and a
 * server that never saw the earlier attempts all arrive at the same number.
 */
export function retryChain(request: TurnRequestEventData): {
  attemptNumber: number;
  originalRequestId: ClientTurnRequestId;
} {
  return {
    attemptNumber: request.retryAttempt ?? 1,
    originalRequestId: request.retryOfRequestId ?? request.requestId,
  };
}

/**
 * The `turn.failed` payload: ids and failure facts, assembled from the failed
 * turn's own records so a listener never replays the event log itself.
 *
 * Deliberately carries no thread DTO and no copy of the message. A retry is
 * asked for BY REFERENCE (`sdk.threads.retry`), so the request id is the whole
 * of what a policy needs, and a listener that wants more reads it when it uses
 * it rather than being handed a snapshot that is already aging.
 *
 * Returns null when the thread is gone or never dispatched a turn — there is
 * no failed turn to announce.
 */
export function buildTurnFailedEvent(
  db: DbConnection,
  threadId: string,
): PluginTurnFailedEvent | null {
  const thread = getThread(db, threadId);
  if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
    return null;
  }
  const failed = loadFailedTurn(db, threadId);
  if (failed === null) return null;
  // The provider's own account of the failure, when the failure happened
  // inside a provider turn at all: it carries both the turn id and the
  // structured classification, so one row answers two fields.
  const providerError = getLatestStoredThreadEventOfTypes(db, {
    threadId,
    types: ["provider/error"],
    afterSequence: failed.requestSequence,
  });
  const errorInfo: ProviderErrorInfo | null =
    providerError === null
      ? null
      : (providerErrorDataSchema.safeParse(parseRowData(providerError)).data
          ?.errorInfo ?? null);
  return {
    threadId,
    requestId: failed.request.requestId,
    turnId: providerError?.turnId ?? null,
    errorInfo,
    rateLimits: latestRateLimits(db, thread),
    attemptNumber: retryChain(failed.request).attemptNumber,
  };
}

function latestRateLimits(
  db: DbConnection,
  thread: Thread,
): ProviderRateLimitState | null {
  const row = getLatestStoredRateLimitsEventForProvider(db, {
    threadId: thread.id,
    providerId: thread.providerId,
  });
  if (row === null) return null;
  return (
    rateLimitsDataSchema.safeParse(parseRowData(row)).data?.rateLimits ?? null
  );
}
