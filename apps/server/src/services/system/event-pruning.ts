import { performance } from "node:perf_hooks";
import { and, eq, inArray, lte } from "drizzle-orm";
import {
  getThread,
  getLatestThreadSequence,
  pruneBackgroundTaskProgressEvents,
  pruneContextWindowUsageEventsBeforeSequence,
  pruneResolvedItemDeltas,
  pruneTokenUsageEventsBeforeSequence,
  pruneThreadEventsBeforeSequence,
  events as storedEvents,
} from "@bb/db";
import type { ThreadEventType } from "@bb/domain";
import { roundDurationMs } from "../lib/duration.js";
import type { AppDeps } from "../../types.js";

type ThreadEventPruningMode = "active" | "archived" | "idle";

interface PruneThreadEventHistoryArgs {
  mode: ThreadEventPruningMode;
  threadId: string;
}

interface ThreadEventPruningResult {
  latestSequence: number;
  removedAgePrunableEvents: number;
  removedBackgroundTaskProgressEvents: number;
  removedResolvedItemDeltas: number;
  sequenceCutoff: number;
  totalRemoved: number;
}

interface MaybePruneActiveThreadEventHistoryArgs {
  latestPrunableSequence: number;
  threadId: string;
}

interface ActiveThreadPruneState {
  lastPrunedAt: number;
  lastPrunedSequence: number;
}

type ThreadEventPruningStep =
  | "get_latest_thread_sequence"
  | "prune_background_task_progress"
  | "prune_context_window_usage"
  | "prune_generic_age_prunable_events"
  | "prune_resolved_item_deltas"
  | "prune_token_usage";

class ThreadEventPruningStepError extends Error {
  readonly step: ThreadEventPruningStep;

  constructor(step: ThreadEventPruningStep, cause: ErrorOptions["cause"]) {
    super(`Thread event pruning step failed: ${step}`, { cause });
    this.name = "ThreadEventPruningStepError";
    this.step = step;
  }
}

const ACTIVE_THREAD_EVENT_KEEP_RECENT = 1_000;
const IDLE_THREAD_EVENT_KEEP_RECENT = 300;
/**
 * Keep-recent window for archived threads. Applied by the on-archive prune
 * (prunable event classes) and by the periodic archived-thread retention
 * sweep (all event classes). Product policy: an archived thread keeps only
 * this many recent sequence slots of history.
 */
export const ARCHIVED_THREAD_EVENT_KEEP_RECENT = 120;
const ACTIVE_THREAD_EVENT_PRUNE_MIN_SEQUENCE_DELTA = 250;
const ACTIVE_THREAD_EVENT_PRUNE_MIN_INTERVAL_MS = 30_000;
const SLOW_THREAD_EVENT_PRUNE_LOG_THRESHOLD_MS = 1_000;

const AGE_PRUNABLE_THREAD_EVENT_TYPES: readonly ThreadEventType[] = [
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/diff/updated",
] as const;

/**
 * Event types whose ingestion may trigger an opportunistic prune of the
 * thread's event history. Covers the age-prunable stream types plus
 * backgroundTask progress snapshots: workflows keep streaming progress after
 * their spawning turn completed, so without this trigger nothing would bound
 * the superseded snapshots until the next turn completes.
 */
const ACTIVE_PRUNE_TRIGGER_THREAD_EVENT_TYPES: readonly ThreadEventType[] = [
  ...AGE_PRUNABLE_THREAD_EVENT_TYPES,
  "item/backgroundTask/progress",
] as const;

const GENERIC_AGE_PRUNABLE_THREAD_EVENT_TYPES: readonly ThreadEventType[] = [
  "turn/diff/updated",
] as const;

/**
 * Candidate types for `pruneResolvedItemDeltas`. Must stay a superset of the
 * delta types that DELETE targets, or the probe below silently disables the
 * prune for the missing type.
 */
const RESOLVED_ITEM_DELTA_THREAD_EVENT_TYPES: readonly ThreadEventType[] = [
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
] as const;

const KEEP_RECENT_BY_MODE: Record<ThreadEventPruningMode, number> = {
  active: ACTIVE_THREAD_EVENT_KEEP_RECENT,
  idle: IDLE_THREAD_EVENT_KEEP_RECENT,
  archived: ARCHIVED_THREAD_EVENT_KEEP_RECENT,
};

const activePruneTriggerThreadEventTypeSet = new Set<ThreadEventType>(
  ACTIVE_PRUNE_TRIGGER_THREAD_EVENT_TYPES,
);
const activeThreadPruneStateByThreadId = new Map<
  string,
  ActiveThreadPruneState
>();

function getThreadEventPruningFailureStep(
  error: ErrorOptions["cause"],
): ThreadEventPruningStep | "unknown" {
  if (error instanceof ThreadEventPruningStepError) {
    return error.step;
  }
  return "unknown";
}

function runThreadEventPruningStep<TValue>(
  step: ThreadEventPruningStep,
  work: () => TValue,
): TValue {
  try {
    return work();
  } catch (error) {
    throw new ThreadEventPruningStepError(step, error);
  }
}

export function isActivePruneTriggerThreadEventType(
  eventType: ThreadEventType,
): boolean {
  return activePruneTriggerThreadEventTypeSet.has(eventType);
}

interface HasPrunableCandidateRowsArgs {
  threadId: string;
  types: readonly ThreadEventType[];
  /** Omit for classes whose DELETE has no sequence bound. */
  sequenceCutoff?: number;
}

/**
 * LIMIT 1 necessary-condition probe for a prune class. The usage-row DELETEs
 * walk every row of their type through a correlated-subquery CTE, and the
 * resolved-delta/background-progress DELETEs walk their candidates with
 * correlated EXISTS checks — even when the thread has no candidate rows at
 * all, which is the common case for an active thread pruned every ~30s. This
 * probe answers "could that DELETE possibly match?" with one covering seek on
 * the (thread_id, type, sequence) index, so the no-op case skips the walk
 * outright. A true result only means candidates exist; the DELETE still
 * decides what is actually prunable.
 */
function hasPrunableCandidateRows(
  db: AppDeps["db"],
  args: HasPrunableCandidateRowsArgs,
): boolean {
  if (args.sequenceCutoff !== undefined && args.sequenceCutoff <= 0) {
    return false;
  }
  return (
    db
      .select({ id: storedEvents.id })
      .from(storedEvents)
      .where(
        and(
          eq(storedEvents.threadId, args.threadId),
          inArray(storedEvents.type, [...args.types]),
          ...(args.sequenceCutoff === undefined
            ? []
            : [lte(storedEvents.sequence, args.sequenceCutoff)]),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function pruneThreadEventHistory(
  deps: Pick<AppDeps, "db">,
  args: PruneThreadEventHistoryArgs,
): ThreadEventPruningResult {
  const latestSequence = runThreadEventPruningStep(
    "get_latest_thread_sequence",
    () =>
      getLatestThreadSequence(deps.db, {
        threadId: args.threadId,
      }),
  );
  const keepRecent = KEEP_RECENT_BY_MODE[args.mode];
  const sequenceCutoff = Math.max(0, latestSequence - keepRecent);
  const removedAgePrunableEvents =
    runThreadEventPruningStep("prune_context_window_usage", () =>
      hasPrunableCandidateRows(deps.db, {
        threadId: args.threadId,
        types: ["thread/contextWindowUsage/updated"],
        sequenceCutoff,
      })
        ? pruneContextWindowUsageEventsBeforeSequence(deps.db, {
            threadId: args.threadId,
            sequenceCutoff,
          })
        : 0,
    ) +
    runThreadEventPruningStep("prune_token_usage", () =>
      hasPrunableCandidateRows(deps.db, {
        threadId: args.threadId,
        types: ["thread/tokenUsage/updated"],
        sequenceCutoff,
      })
        ? pruneTokenUsageEventsBeforeSequence(deps.db, {
            threadId: args.threadId,
            sequenceCutoff,
          })
        : 0,
    ) +
    // No probe: this DELETE is already a plain (thread_id, type, sequence)
    // index-range scan, exactly what the probe would run.
    runThreadEventPruningStep("prune_generic_age_prunable_events", () =>
      pruneThreadEventsBeforeSequence(deps.db, {
        threadId: args.threadId,
        sequenceCutoff,
        types: GENERIC_AGE_PRUNABLE_THREAD_EVENT_TYPES,
      }),
    );
  const removedResolvedItemDeltas = runThreadEventPruningStep(
    "prune_resolved_item_deltas",
    () =>
      hasPrunableCandidateRows(deps.db, {
        threadId: args.threadId,
        types: RESOLVED_ITEM_DELTA_THREAD_EVENT_TYPES,
      })
        ? pruneResolvedItemDeltas(deps.db, {
            threadId: args.threadId,
          })
        : 0,
  );
  const removedBackgroundTaskProgressEvents = runThreadEventPruningStep(
    "prune_background_task_progress",
    () =>
      hasPrunableCandidateRows(deps.db, {
        threadId: args.threadId,
        types: ["item/backgroundTask/progress"],
      })
        ? pruneBackgroundTaskProgressEvents(deps.db, {
            threadId: args.threadId,
          })
        : 0,
  );

  return {
    latestSequence,
    removedAgePrunableEvents,
    removedBackgroundTaskProgressEvents,
    removedResolvedItemDeltas,
    sequenceCutoff,
    totalRemoved:
      removedAgePrunableEvents +
      removedBackgroundTaskProgressEvents +
      removedResolvedItemDeltas,
  };
}

export function pruneThreadEventHistoryBestEffort(
  deps: Pick<AppDeps, "db" | "logger">,
  args: PruneThreadEventHistoryArgs,
): ThreadEventPruningResult | null {
  const startedAt = performance.now();
  try {
    const result = pruneThreadEventHistory(deps, args);
    const durationMs = performance.now() - startedAt;
    if (durationMs >= SLOW_THREAD_EVENT_PRUNE_LOG_THRESHOLD_MS) {
      deps.logger.debug(
        {
          durationMs: roundDurationMs(durationMs),
          latestSequence: result.latestSequence,
          mode: args.mode,
          threadId: args.threadId,
          totalRemoved: result.totalRemoved,
        },
        "Slow thread event pruning",
      );
    }
    return result;
  } catch (error) {
    deps.logger.warn(
      {
        durationMs: roundDurationMs(performance.now() - startedAt),
        mode: args.mode,
        step: getThreadEventPruningFailureStep(error),
        threadId: args.threadId,
        err: error,
      },
      "Failed to prune thread event history",
    );
    return null;
  }
}

export function maybePruneActiveThreadEventHistory(
  deps: Pick<AppDeps, "db" | "logger">,
  args: MaybePruneActiveThreadEventHistoryArgs,
): ThreadEventPruningResult | null {
  const thread = getThread(deps.db, args.threadId);
  // Idle threads still ingest prunable streams: a backgrounded workflow keeps
  // emitting thread-scoped progress snapshots after its spawning turn
  // completed, which is exactly when nothing else would prune them.
  if (
    !thread ||
    (thread.status !== "active" && thread.status !== "idle") ||
    thread.archivedAt !== null
  ) {
    return null;
  }

  const lastState = activeThreadPruneStateByThreadId.get(args.threadId);
  const lastPrunedSequence = lastState?.lastPrunedSequence ?? 0;
  if (
    args.latestPrunableSequence - lastPrunedSequence <
    ACTIVE_THREAD_EVENT_PRUNE_MIN_SEQUENCE_DELTA
  ) {
    return null;
  }

  const now = Date.now();
  const lastPrunedAt = lastState?.lastPrunedAt ?? 0;
  if (now - lastPrunedAt < ACTIVE_THREAD_EVENT_PRUNE_MIN_INTERVAL_MS) {
    return null;
  }

  activeThreadPruneStateByThreadId.set(args.threadId, {
    lastPrunedAt: now,
    lastPrunedSequence: args.latestPrunableSequence,
  });

  return pruneThreadEventHistoryBestEffort(deps, {
    mode: thread.status === "active" ? "active" : "idle",
    threadId: args.threadId,
  });
}

export function resetActiveThreadEventPruningState(threadId: string): void {
  activeThreadPruneStateByThreadId.delete(threadId);
}
