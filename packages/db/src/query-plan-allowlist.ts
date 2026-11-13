import type { QueryPlanAllowlistEntry } from "./query-plan-guard.js";

const EVENTS = "packages/db/src/data/events.ts";
const QUEUED = "packages/db/src/data/queued-thread-messages.ts";
const THREAD_LIFECYCLE = "apps/server/src/services/threads/thread-lifecycle.ts";

function acceptedEventsIndex(
  caller: string,
  reason: string,
): QueryPlanAllowlistEntry {
  return { rule: "weaker-index", table: "events", caller, reason };
}

function boundedCorrelatedEvents(
  caller: string,
  reason: string,
): QueryPlanAllowlistEntry {
  return { rule: "correlated-subquery", table: "events", caller, reason };
}

export const QUERY_PLAN_ALLOWLIST: readonly QueryPlanAllowlistEntry[] = [
  acceptedEventsIndex(
    `${EVENTS}#isStoredTurnMainRunIdle`,
    "turn/mainRun/updated is rare per thread; measured 0.013 ms vs 0.012 ms",
  ),
  acceptedEventsIndex(
    `${EVENTS}#getStoredTurnRequestEventForTurn`,
    "turn/input/accepted is one per turn; measured 0.04 ms vs 0.01 ms",
  ),
  acceptedEventsIndex(
    "apps/server/src/services/threads/thread-edit-message.ts#getTurnCompletion",
    "turn/completed is one per turn, so the type index reads at most one row per turn",
  ),
  acceptedEventsIndex(
    `${EVENTS}#listStoredTurnCompletedRowsByTurnIds`,
    "turn/completed is one per turn, so the type index reads at most one row per turn",
  ),
  acceptedEventsIndex(
    "apps/server/src/services/threads/environment-directory-continuation.ts#findEnvironmentDirectoryContinuation",
    "system/operation events are rare per thread",
  ),
  acceptedEventsIndex(
    `${EVENTS}#wouldRemoveSharedProviderSessionClaim`,
    "the partial thread/identity index holds one row per provider session",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#queryBatch`,
    "ORDER BY sequence DESC LIMIT 1 reads one index entry per requested thread",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#listThreadTurnInterruptionEventStates`,
    "The subquery supplies the outer search's sequence, so it runs once per thread; check:query-costs measures it",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#listThreadIdsStoppedSinceLastTurnStart`,
    "The subquery supplies the outer search's sequence, so it runs once per thread; check:query-costs measures it",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#listThreadIdsWithLatestHostDaemonRestartInterruption`,
    "MAX(sequence) on the unique thread/sequence index reads one entry, once per thread",
  ),
  boundedCorrelatedEvents(
    `${QUEUED}#isThreadQueueAutoSendPaused`,
    "Runs per manual stop; the later-request EXISTS seeks the first request after the stop and the NOT EXISTS ends at the first later turn start; check:query-costs measures it",
  ),
  boundedCorrelatedEvents(
    `${QUEUED}#listIdleThreadsWithQueuedMessages`,
    "Same manual-stop pause check as isThreadQueueAutoSendPaused, per idle thread with queued messages",
  ),
  boundedCorrelatedEvents(
    `${QUEUED}#deleteQueuedRetriesForThreadEventSuffixInTransaction`,
    "Runs per queued retry of the thread; the search is confined to the deleted suffix's sequence range",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#findLatestUnresolvedClientTurnRequestIdAfterSequence`,
    "Outer rows are requests after the last completed turn, and each search starts at its request's sequence; check:query-costs measures it",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#getFirstParentedTimelineBoundarySequence`,
    "Runs once per delegation span and reads only the requests inside it; check:query-costs measures it",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#listLatestTurnFinalAgentMessageEventRows`,
    "LIMIT keeps the outer rows to the newest replies, so each later-reply search covers only the newest turns; check:query-costs measures it",
  ),
  boundedCorrelatedEvents(
    `${EVENTS}#getStoredConversationOutlineProjectionState`,
    "LIMIT 1: the root-request search runs only for nested turns, and the first nested turn with a matching root ends the query; check:query-costs measures it",
  ),
  boundedCorrelatedEvents(
    `${THREAD_LIFECYCLE}#list`,
    "Turn-start deadline sweep over active threads; reads each thread's turn/completed rows once per sweep, linear in turns",
  ),
  boundedCorrelatedEvents(
    `${THREAD_LIFECYCLE}#markTurnStartDeadlineStopInTransaction`,
    "Rechecks one deadline candidate; reads its turn/completed rows once, linear in turns",
  ),
  {
    rule: "full-scan",
    table: "prompt_history_entries",
    caller: "packages/db/src/data/prompt-history.ts#listPromptHistoryPage",
    reason: "Keyset page that walks the created_at index and stops at LIMIT",
  },
  {
    rule: "full-scan",
    table: "terminal_sessions",
    caller: "packages/db/src/data/terminal-sessions.ts#listTerminalSessions",
    reason:
      "The unfiltered unscoped listing runs only in tests; production's unscoped caller filters by visible status through the status index",
  },
  {
    rule: "automatic-index",
    table: "ordered_threads",
    caller: "packages/db/src/data/threads.ts#listThreadSearchMatchRows",
    reason: "Automatic index over the search CTE, bounded by matching threads",
  },
];
