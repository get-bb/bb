import {
  copyStoredThreadEventsInTransaction,
  findLastCompletedRootStoredTurn,
  findLastRootStoredTurnStarted,
  listStoredEventRows,
  listStoredTurnCompletedRowsByTurnIds,
  type StoredEventRow,
} from "@bb/db";
import type { Thread, ThreadEvent, ThreadEventType } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { parseStoredEvent } from "./thread-data.js";
import {
  getLastProviderThreadId,
  parseStoredTurnRequestEvent,
} from "./thread-events.js";
import { resolveTurnProviderCheckpointId } from "./thread-edit-message.js";
import type { ThreadForkDescriptor } from "./thread-provisioning-context.js";

/**
 * Where a fork branches off its source: the provider session to clone (and
 * the checkpoint to retain through; none for the tip) plus the last source
 * sequence whose conversation the fork inherits. `historyEndSequence` is the
 * `turn/completed` of the turn the clone ends on, so the timeline the fork
 * shows and the context its model holds describe the same conversation. Null
 * when the source has not completed a root turn yet.
 */
export interface ThreadForkPoint {
  descriptor: ThreadForkDescriptor;
  historyEndSequence: number | null;
  sourceThreadId: string;
}

function forkPointUnavailable(message: string): never {
  throw new ApiError(400, "fork_source_session_unavailable", message);
}

interface StoredTurnCompletion {
  event: Extract<ThreadEvent, { type: "turn/completed" }>;
  sequence: number;
}

function readTurnCompletion(
  deps: Pick<AppDeps, "db">,
  args: { threadId: string; turnId: string },
): StoredTurnCompletion | null {
  const row = listStoredTurnCompletedRowsByTurnIds(deps.db, {
    threadId: args.threadId,
    turnIds: [args.turnId],
  }).at(-1);
  if (row === undefined) {
    return null;
  }
  const event = parseStoredEvent(row);
  if (event.type !== "turn/completed") {
    throw new Error(`Expected turn/completed event #${row.sequence}`);
  }
  return { event, sequence: row.sequence };
}

/**
 * The descriptor that re-creates a completed turn's session through the
 * checkpoint its completion recorded, or null when that turn left no session
 * or checkpoint to branch from.
 */
function resolveCheckpointForkDescriptor(args: {
  completion: StoredTurnCompletion;
  providerId: string;
  turnId: string;
}): ThreadForkDescriptor | null {
  if (args.completion.event.providerThreadId === null) {
    return null;
  }
  const sourceProviderCheckpointId = resolveTurnProviderCheckpointId({
    providerCheckpointId: args.completion.event.providerCheckpointId,
    providerId: args.providerId,
    turnId: args.turnId,
  });
  if (sourceProviderCheckpointId === null) {
    return null;
  }
  return {
    sourceProviderThreadId: args.completion.event.providerThreadId,
    sourceProviderCheckpointId,
  };
}

/**
 * Resolve the branch point for `sourceSeqEnd`. The anchor is the root turn
 * that contains the sequence, or the last root turn before it when the
 * sequence sits between turns (a user message row precedes its turn, so
 * forking at one branches before that message, like editing it does). The
 * anchor must have completed: a checkpoint is recorded on `turn/completed`,
 * and a turn still running has no stable point to clone. Providers that can
 * only clone a whole session (`fork: "tip"`) accept the anchor only when it
 * is the source's latest turn; otherwise the clone would silently include
 * turns the caller asked to leave out.
 */
function resolveAnchoredForkPoint(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: { sourceSeqEnd: number; sourceThread: Thread },
): ThreadForkPoint {
  const anchor = findLastRootStoredTurnStarted(deps.db, {
    atOrBeforeSequence: args.sourceSeqEnd,
    threadId: args.sourceThread.id,
  });
  if (anchor === null) {
    forkPointUnavailable(
      `Cannot fork at sequence ${args.sourceSeqEnd}: no turn has started at or before it`,
    );
  }
  const completion = readTurnCompletion(deps, {
    threadId: args.sourceThread.id,
    turnId: anchor.turnId,
  });
  if (completion === null) {
    forkPointUnavailable(
      `Cannot fork at sequence ${args.sourceSeqEnd}: the turn containing it has not completed`,
    );
  }
  if (completion.event.providerThreadId === null) {
    forkPointUnavailable(
      `Cannot fork at sequence ${args.sourceSeqEnd}: the turn containing it has no provider session`,
    );
  }
  const latestRootTurn = findLastRootStoredTurnStarted(deps.db, {
    threadId: args.sourceThread.id,
  });
  const anchorIsTip = latestRootTurn?.turnId === anchor.turnId;
  if (
    !deps.providerRegistry.supportsSessionRewind(args.sourceThread.providerId)
  ) {
    if (!anchorIsTip) {
      forkPointUnavailable(
        `Provider ${args.sourceThread.providerId} can only fork at the end of a session, not from an earlier point in it`,
      );
    }
    return {
      descriptor: {
        sourceProviderThreadId: completion.event.providerThreadId,
      },
      historyEndSequence: completion.sequence,
      sourceThreadId: args.sourceThread.id,
    };
  }
  const descriptor = resolveCheckpointForkDescriptor({
    completion,
    providerId: args.sourceThread.providerId,
    turnId: anchor.turnId,
  });
  if (descriptor === null) {
    forkPointUnavailable(
      `Cannot fork at sequence ${args.sourceSeqEnd}: the turn containing it recorded no provider checkpoint`,
    );
  }
  return {
    descriptor,
    historyEndSequence: completion.sequence,
    sourceThreadId: args.sourceThread.id,
  };
}

/**
 * Resolve where a fork of `sourceThread` branches. Without `sourceSeqEnd` the
 * fork inherits every completed root turn and clones the session tip. When
 * the source is mid-turn, its session tip already holds the running turn's
 * prompt and partial output, which the inherited timeline stops short of; a
 * provider that can branch at a checkpoint then clones through the last
 * completed turn instead, so model context and timeline describe the same
 * conversation. Returns null when the source has no provider session to
 * clone; throws `fork_source_session_unavailable` when `sourceSeqEnd` names a
 * point the provider cannot branch from.
 */
export function resolveThreadForkPoint(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: { sourceSeqEnd: number | undefined; sourceThread: Thread },
): ThreadForkPoint | null {
  if (args.sourceSeqEnd !== undefined) {
    return resolveAnchoredForkPoint(deps, {
      sourceSeqEnd: args.sourceSeqEnd,
      sourceThread: args.sourceThread,
    });
  }
  const sourceProviderThreadId = getLastProviderThreadId(
    deps,
    args.sourceThread.id,
  );
  if (sourceProviderThreadId === null) {
    return null;
  }
  const lastCompletedTurn = findLastCompletedRootStoredTurn(deps.db, {
    threadId: args.sourceThread.id,
  });
  const tip: ThreadForkPoint = {
    descriptor: { sourceProviderThreadId },
    historyEndSequence: lastCompletedTurn?.completedSequence ?? null,
    sourceThreadId: args.sourceThread.id,
  };
  if (
    lastCompletedTurn === null ||
    !deps.providerRegistry.supportsSessionRewind(args.sourceThread.providerId)
  ) {
    return tip;
  }
  const latestRootTurn = findLastRootStoredTurnStarted(deps.db, {
    threadId: args.sourceThread.id,
  });
  if (latestRootTurn?.turnId === lastCompletedTurn.turnId) {
    return tip;
  }
  const completion = readTurnCompletion(deps, {
    threadId: args.sourceThread.id,
    turnId: lastCompletedTurn.turnId,
  });
  const descriptor =
    completion === null
      ? null
      : resolveCheckpointForkDescriptor({
          completion,
          providerId: args.sourceThread.providerId,
          turnId: lastCompletedTurn.turnId,
        });
  return descriptor === null ? tip : { ...tip, descriptor };
}

/**
 * The events that carry the conversation a fork inherits. Everything else the
 * source recorded is either the source's own bookkeeping (identity,
 * provisioning, usage snapshots, operations), streaming deltas the completed
 * items already fold in, or pending-interaction and goal state that belongs to
 * the source thread alone.
 */
const INHERITED_EVENT_TYPES = [
  "client/turn/requested",
  "turn/started",
  "turn/input/accepted",
  "item/completed",
  "item/backgroundTask/completed",
  "turn/completed",
  "thread/compacted",
  "system/manager/user_message",
] as const satisfies readonly ThreadEventType[];

function parseAcceptedClientRequestId(row: StoredEventRow): string {
  const event = parseStoredEvent(row);
  if (event.type !== "turn/input/accepted") {
    throw new Error(`Expected turn/input/accepted event #${row.sequence}`);
  }
  return event.clientRequestId;
}

/**
 * Select the rows of the source conversation through `historyEndSequence`.
 * Only turns that completed inside the window come along, so the fork never
 * shows a turn that is still running; a `client/turn/requested` comes along
 * only when the window also holds its acceptance, so a message the source had
 * merely queued does not show as pending in the fork. The rows are read into
 * memory because each copy is re-parsed to index search segments; the filter
 * here only drops the few rows of turns and requests still open at the
 * window's end.
 */
function selectInheritedForkEventRows(
  deps: Pick<AppDeps, "db">,
  args: { historyEndSequence: number; sourceThreadId: string },
): StoredEventRow[] {
  const rows = listStoredEventRows(deps.db, {
    beforeSequence: args.historyEndSequence + 1,
    threadId: args.sourceThreadId,
    types: INHERITED_EVENT_TYPES,
  });
  const completedTurnIds = new Set<string>();
  const acceptedClientRequestIds = new Set<string>();
  for (const row of rows) {
    if (row.type === "turn/completed" && row.turnId !== null) {
      completedTurnIds.add(row.turnId);
    } else if (row.type === "turn/input/accepted") {
      acceptedClientRequestIds.add(parseAcceptedClientRequestId(row));
    }
  }
  return rows.filter((row) => {
    if (row.turnId !== null) {
      return completedTurnIds.has(row.turnId);
    }
    if (row.type !== "client/turn/requested") {
      return true;
    }
    return acceptedClientRequestIds.has(
      parseStoredTurnRequestEvent(row).requestId,
    );
  });
}

/**
 * Copy the source conversation through `historyEndSequence` into a fork
 * before the fork's own thread-start rows are appended, so inherited history
 * occupies the lowest sequences and renders first. Copied rows carry no
 * `provider_thread_id` column value: that column names the session a thread
 * owns and resumes, and the fork owns only the session its own
 * `thread/identity` will name. The event payloads keep the source session id,
 * so a later rewind or nested fork anchored on an inherited turn still finds
 * the session that recorded its checkpoint.
 */
export function copyForkSourceHistory(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    fork: Pick<Thread, "environmentId" | "id">;
    historyEndSequence: number;
    sourceThreadId: string;
  },
): void {
  const rows = selectInheritedForkEventRows(deps, {
    historyEndSequence: args.historyEndSequence,
    sourceThreadId: args.sourceThreadId,
  }).map((row) => ({ ...row, providerThreadId: null }));
  if (rows.length === 0) {
    return;
  }
  deps.db.transaction(
    (tx) =>
      copyStoredThreadEventsInTransaction(tx, {
        rows,
        targetEnvironmentId: args.fork.environmentId,
        targetThreadId: args.fork.id,
      }),
    { behavior: "immediate" },
  );
  deps.hub.notifyThread(args.fork.id, ["events-appended"], {
    eventTypes: [...new Set(rows.map((row) => row.type))],
  });
}
