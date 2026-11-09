import type { QueryPlanAllowlistEntry } from "./query-plan-guard.js";

const EVENTS = "packages/db/src/data/events.ts";

function acceptedEventsIndex(
  caller: string,
  reason: string,
): QueryPlanAllowlistEntry {
  return { rule: "weaker-index", table: "events", caller, reason };
}

export const QUERY_PLAN_ALLOWLIST: readonly QueryPlanAllowlistEntry[] = [
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
