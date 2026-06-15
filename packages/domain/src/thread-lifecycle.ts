import type { ThreadStatus } from "./thread-status.js";

/**
 * What happened to a thread, in product terms. Callers report events instead
 * of choosing target statuses; THREAD_LIFECYCLE maps (status, event) → next
 * status and THREAD_LIFECYCLE_EVENT_PREDICATES declares which staleness
 * signals supersede each event.
 *
 * The execution status is the single source of truth for "what is this thread
 * doing": `idle` (quiescent), `starting` (preparing a run), `active` (agent
 * work is in progress), `stopping` (the current run/start is winding down),
 * and `error` (quiescent after failure). In-progress intent lives in the
 * status, not in side-fields: a requested stop IS `status = stopping`, not a
 * separate `stopRequestedAt`. Only the orthogonal record dimensions
 * (deletedAt/archivedAt) are fields, surfaced here as supersession predicates.
 *
 * Events carry no payloads yet: the threads row stores no turn id, and neither
 * the table, the predicates, nor the db writer consumes any event data.
 *
 * Vocabulary:
 * - `run.preparing` — new work needs preparation before it can run.
 * - `run.started` — the current run is in progress.
 * - `run.succeeded` — the current run completed successfully.
 * - `run.failed` — the current run/start failed.
 * - `stop.requested` — the user/system asked to stop the current run/start.
 * - `stop.settled` — stop/interruption finished and the thread is idle.
 */
export type ThreadLifecycleEvent =
  | { type: "run.preparing" }
  | { type: "run.started" }
  | { type: "run.succeeded" }
  | { type: "run.failed" }
  | { type: "stop.requested" }
  | { type: "stop.settled" };

export type ThreadLifecycleEventType = ThreadLifecycleEvent["type"];

/**
 * Declarative supersession predicates: row-level staleness signals that turn
 * an otherwise-legal event into a "superseded" no-op. Only the orthogonal
 * record dimensions remain — stop intent is no longer a predicate because it
 * is the `stopping` status (the table simply has no "begin new work"
 * transition out of `stopping`).
 */
export interface ThreadLifecycleSupersessionPredicates {
  notArchived?: true;
  notDeleted?: true;
}

export const THREAD_LIFECYCLE_EVENT_PREDICATES: Record<
  ThreadLifecycleEventType,
  ThreadLifecycleSupersessionPredicates
> = {
  "run.preparing": { notArchived: true, notDeleted: true },
  "run.started": { notArchived: true, notDeleted: true },
  "run.succeeded": {},
  "run.failed": { notDeleted: true },
  "stop.requested": {},
  "stop.settled": {},
};

/**
 * The thread execution state machine. `stopping` is a first-class status that
 * captures the "stop requested" intent durably; dispatching new work into it
 * is structurally impossible (no `run.started` cell), which is what makes a
 * scheduled/queued turn unable to reactivate a stopping thread. Absent cell =
 * the event is a no-op in that status.
 */
export const THREAD_LIFECYCLE: Record<
  ThreadStatus,
  Partial<Record<ThreadLifecycleEventType, ThreadStatus>>
> = {
  idle: {
    "run.preparing": "starting",
    "run.started": "active",
  },
  starting: {
    "run.started": "active",
    "run.failed": "error",
    "stop.requested": "stopping",
  },
  active: {
    "run.succeeded": "idle",
    "run.failed": "error",
    "stop.requested": "stopping",
  },
  stopping: {
    "stop.settled": "idle",
    "run.succeeded": "idle",
    "run.failed": "error",
  },
  error: {
    "run.preparing": "starting",
    "run.started": "active",
  },
};

/** The thread-row fields supersession predicates evaluate against. */
export interface ThreadLifecycleRowState {
  archivedAt: number | null;
  deletedAt: number | null;
  status: ThreadStatus;
}

export type ThreadLifecycleNoopReason = "illegal-transition" | "superseded";

export type ThreadLifecycleEvaluation =
  | { to: ThreadStatus }
  | { noop: ThreadLifecycleNoopReason; detail: string };

export interface EvaluateThreadLifecycleEventArgs {
  event: ThreadLifecycleEvent;
  thread: ThreadLifecycleRowState;
}

/**
 * Pure evaluation of a lifecycle event against a loaded thread row.
 * Supersession is checked before table lookup so a stale event on a
 * deleted/archived thread reports "superseded" even when the current status
 * has no cell for it.
 */
export function evaluateThreadLifecycleEvent(
  args: EvaluateThreadLifecycleEventArgs,
): ThreadLifecycleEvaluation {
  const { event, thread } = args;
  const predicates = THREAD_LIFECYCLE_EVENT_PREDICATES[event.type];
  if (predicates.notDeleted && thread.deletedAt !== null) {
    return { noop: "superseded", detail: "deletedAt set" };
  }
  if (predicates.notArchived && thread.archivedAt !== null) {
    return { noop: "superseded", detail: "archivedAt set" };
  }

  const to = THREAD_LIFECYCLE[thread.status][event.type];
  if (to === undefined) {
    return {
      noop: "illegal-transition",
      detail: `no transition for ${event.type} from status ${thread.status}`,
    };
  }
  return { to };
}
