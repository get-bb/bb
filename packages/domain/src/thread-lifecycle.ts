import type { ThreadStatus } from "./thread-status.js";

/**
 * What happened to a thread, in product terms. Callers report events instead
 * of choosing target statuses; THREAD_LIFECYCLE maps (status, event) → next
 * status and THREAD_LIFECYCLE_EVENT_PREDICATES declares which staleness
 * signals supersede each event.
 *
 * The execution status is the single source of truth for "what is this thread
 * doing": `created`/`provisioning` (pre-start), `active` (the agent is
 * working — a turn is dispatched or running), `stopping` (the user asked to
 * stop; the turn is winding down), `idle` (settled, clean), `error` (settled,
 * failed). In-progress intent lives in the status, not in side-fields: a
 * requested stop IS `status = stopping`, not a separate `stopRequestedAt`.
 * Only the orthogonal record dimensions (deletedAt/archivedAt) are fields,
 * surfaced here as supersession predicates.
 *
 * Events carry no payloads yet: the threads row stores no turn id, and neither
 * the table, the predicates, nor the db writer consumes any event data.
 *
 * Vocabulary (sources are the call sites inventoried in
 * packages/domain/test/thread-lifecycle.test.ts):
 * - `turn.started` — daemon reported a provider turn began.
 * - `turn.completed` — daemon reported a turn finished successfully.
 * - `turn.failed` — daemon reported a turn failed.
 * - `turn.interrupted` — daemon reported a turn was interrupted (stop ack).
 * - `runtime.exited` — provider process exited unexpectedly.
 * - `turn.dispatched` — server dispatched a turn to a ready runtime (send,
 *   queued auto-send, parent system message, due schedule).
 * - `reprovision.started` — workspace restore began for a queued turn.
 * - `start.succeeded` — thread.start RPC settled successfully.
 * - `command.failed` — a thread.start / turn.submit RPC failed.
 * - `provision.failed` — thread or environment provisioning failed.
 * - `workspace.lost` — the environment was destroyed under a live thread.
 * - `stop.requested` — the user/system asked to stop a running or pre-start
 *   thread; the thread enters `stopping`.
 * - `stop.completed` — a requested stop finished (manual stop).
 * - `session.lost` — daemon restart/disconnect lost the live runtime.
 * - `runtime.observed-active` — daemon reconciliation reports the thread
 *   running even though the server thought it was not.
 */
export type ThreadLifecycleEvent =
  | { type: "turn.started" }
  | { type: "turn.completed" }
  | { type: "turn.failed" }
  | { type: "turn.interrupted" }
  | { type: "runtime.exited" }
  | { type: "turn.dispatched" }
  | { type: "reprovision.started" }
  | { type: "start.succeeded" }
  | { type: "command.failed" }
  | { type: "provision.failed" }
  | { type: "workspace.lost" }
  | { type: "stop.requested" }
  | { type: "stop.completed" }
  | { type: "session.lost" }
  | { type: "runtime.observed-active" };

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
  "turn.started": {},
  "turn.completed": {},
  "turn.failed": {},
  "turn.interrupted": {},
  "runtime.exited": {},
  // A dispatch must never reactivate a thread that was deleted or archived
  // after the caller's eligibility check (a claim/dispatch TOCTOU window). The
  // stop dimension is already structural: `stopping` has no turn.dispatched
  // cell.
  "turn.dispatched": { notArchived: true, notDeleted: true },
  "reprovision.started": {},
  "start.succeeded": { notArchived: true, notDeleted: true },
  "command.failed": { notDeleted: true },
  "provision.failed": { notDeleted: true },
  "workspace.lost": { notArchived: true, notDeleted: true },
  "stop.requested": {},
  "stop.completed": {},
  "session.lost": {},
  "runtime.observed-active": { notDeleted: true },
};

/**
 * The thread execution state machine. `stopping` is a first-class status that
 * captures the "stop requested" intent durably; dispatching new work into it
 * is structurally impossible (no `turn.dispatched`/`turn.started`/
 * `start.succeeded` cell), which is what makes a scheduled/queued turn unable
 * to reactivate a stopping thread. Absent cell = the event is a no-op in that
 * status.
 */
export const THREAD_LIFECYCLE: Record<
  ThreadStatus,
  Partial<Record<ThreadLifecycleEventType, ThreadStatus>>
> = {
  created: {
    // Daemon turn events can land before thread.start settles, so a pre-start
    // thread activates (or idles) straight from "created".
    "turn.started": "active",
    "turn.completed": "idle",
    "turn.failed": "error",
    "turn.interrupted": "idle",
    "runtime.exited": "error",
    "start.succeeded": "active",
    "command.failed": "error",
    // An environment-level provision failure errors every live thread bound to
    // the environment regardless of its own status.
    "provision.failed": "error",
    "workspace.lost": "error",
    // A stop can be requested before the thread starts (cancel a pending
    // launch); it winds down through "stopping" like any other stop.
    "stop.requested": "stopping",
    "session.lost": "error",
    "runtime.observed-active": "active",
  },
  provisioning: {
    "turn.started": "active",
    "turn.completed": "idle",
    "turn.failed": "error",
    "turn.interrupted": "idle",
    "runtime.exited": "error",
    "start.succeeded": "active",
    "command.failed": "error",
    "provision.failed": "error",
    "workspace.lost": "error",
    "stop.requested": "stopping",
    "session.lost": "error",
    "runtime.observed-active": "active",
  },
  idle: {
    "turn.started": "active",
    // Turn/runtime failures arriving while idle flip the thread to "error"
    // even though no turn is active (e.g. a late provider process exit).
    "turn.failed": "error",
    "runtime.exited": "error",
    "turn.dispatched": "active",
    "reprovision.started": "provisioning",
    "start.succeeded": "active",
    "command.failed": "error",
    "provision.failed": "error",
    "workspace.lost": "error",
    "runtime.observed-active": "active",
  },
  active: {
    "turn.completed": "idle",
    "turn.failed": "error",
    "turn.interrupted": "idle",
    "runtime.exited": "error",
    "command.failed": "error",
    "provision.failed": "error",
    "workspace.lost": "error",
    // The user asked to stop the running turn — enter "stopping" and wait for
    // the daemon to confirm.
    "stop.requested": "stopping",
    "session.lost": "error",
  },
  stopping: {
    // The stop landed — by explicit completion, by the turn finishing on its
    // own, or by an interruption ack — all settle to "idle".
    "stop.completed": "idle",
    "turn.completed": "idle",
    "turn.interrupted": "idle",
    // The turn or its process died while stopping → surface as an error.
    "turn.failed": "error",
    "runtime.exited": "error",
    "provision.failed": "error",
    "workspace.lost": "error",
    "command.failed": "error",
    // A daemon restart during stop means the turn is gone — the stop the user
    // asked for is satisfied, so settle to "idle" (not "error").
    "session.lost": "idle",
    // Deliberately NO turn.dispatched / turn.started / start.succeeded /
    // runtime.observed-active: a stopping thread does not accept new work or
    // reactivate. This is the structural form of the old notStopRequested
    // guard.
  },
  error: {
    "turn.started": "active",
    "turn.completed": "idle",
    "turn.interrupted": "idle",
    // Errored threads activate optimistically when a turn is dispatched,
    // before any daemon acknowledgement; command.failed walks it back.
    "turn.dispatched": "active",
    // Callers additionally require that the errored thread never started (no
    // provider thread id) — an event-log condition the row cannot express; it
    // stays at the caller.
    "reprovision.started": "provisioning",
    "start.succeeded": "active",
    "runtime.observed-active": "active",
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
