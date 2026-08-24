import type { ThreadEventType } from "@bb/domain";

/**
 * Event types a timeline window must not spend anything on: none of them
 * produce a row, so reading them only costs SQLite I/O and a `JSON.parse`.
 *
 * `turn/diff/updated` belongs here for cost, not just tidiness. It carries a
 * full workspace diff — one observed thread held 11.3 MB of them across 144
 * rows, more than 90 % of everything its window read — and the projection
 * classifies it as a duplicate event and drops it.
 *
 * `turn/plan/updated` is NOT here: persisted codex plan notifications decode
 * into `planSteps` items at read time (legacy-thread-events.ts), so a window
 * must read them to show old threads' plans.
 */
export const THREAD_TIMELINE_EXCLUDED_EVENT_TYPES = [
  "thread/started",
  "thread/identity",
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/diff/updated",
] as const satisfies readonly ThreadEventType[];
