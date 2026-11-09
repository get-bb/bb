import type { QueryPlanAllowlistEntry } from "./query-plan-guard.js";

const EVENTS = "packages/db/src/data/events.ts";

function knownSlow(caller: string, measured: string): QueryPlanAllowlistEntry {
  return {
    rule: "weaker-index",
    table: "events",
    caller,
    reason: `Known slow, fix pending: ${measured}`,
  };
}

function acceptedEventsIndex(
  caller: string,
  reason: string,
): QueryPlanAllowlistEntry {
  return { rule: "weaker-index", table: "events", caller, reason };
}

export const QUERY_PLAN_ALLOWLIST: readonly QueryPlanAllowlistEntry[] = [
  knownSlow(
    `${EVENTS}#getUnfinishedCommandItemData`,
    "the NOT EXISTS probe walks every event in the thread per started command; 2.7-5.6 s on real 190-command turns, 2-7 ms when it also matches turn_id",
  ),
  knownSlow(
    `${EVENTS}#getLatestStoredThreadEventOfTypes`,
    "walks the open turn instead of seeking the types; 2.8 ms vs 0.016 ms in a 20k-event turn",
  ),
  knownSlow(
    `${EVENTS}#listStoredClientTurnRequestIdsInRange`,
    "walks the sequence range instead of seeking the type; 0.95 ms vs 0.007 ms in a 20k-event turn",
  ),
  knownSlow(
    `${EVENTS}#findLastCompletedRootStoredTurn`,
    "walks the thread instead of seeking turn/started; 2.6 ms vs 0.025 ms on a 73k-event thread",
  ),
  knownSlow(
    `${EVENTS}#isStoredTurnContextCompactionOnly`,
    "reads every item/completed in the thread instead of the turn; 14.7 ms vs 0.9 ms",
  ),
  knownSlow(
    "apps/server/src/internal/events.ts#getTurnInterruption",
    "walks the open turn instead of seeking the type; 2.4 ms vs 0.01 ms in a 20k-event turn",
  ),
  knownSlow(
    `${EVENTS}#listThreadEventSuffixBackgroundSettlementRows`,
    "correlated settlement probes match only thread_id, the getUnfinishedCommandItemData shape; unmeasured",
  ),
  acceptedEventsIndex(
    `${EVENTS}#listCommandItemDataByItemIds`,
    "Measured faster than the type index (12.6 ms vs 21.6 ms): item ids are selective and both types are common",
  ),
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
