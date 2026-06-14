import type { ThreadStatus } from "./thread-status.js";

/**
 * What happened to a thread, in product terms. Callers report events instead
 * of choosing target statuses; THREAD_LIFECYCLE maps (status, event) → next
 * status and THREAD_LIFECYCLE_EVENT_PREDICATES declares which staleness
 * signals supersede each event.
 *
 * Events deliberately carry no payloads yet: the threads row stores no turn
 * id, and neither the table, the predicates, nor the db writer consumes any
 * event data. Add a per-event payload the moment a predicate or writer needs
 * one (e.g. a persisted active-turn id comparison).
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
  | { type: "stop.completed" }
  | { type: "session.lost" }
  | { type: "runtime.observed-active" };

export type ThreadLifecycleEventType = ThreadLifecycleEvent["type"];

/**
 * Declarative supersession predicates: row-level staleness signals that turn
 * an otherwise-legal event into a "superseded" no-op. A flag is present only
 * when every call site of the event observed today guards on that signal —
 * stronger per-caller guards stay at the caller until the migration tightens
 * them deliberately.
 */
export interface ThreadLifecycleSupersessionPredicates {
  notArchived?: true;
  notDeleted?: true;
  notStopRequested?: true;
}

export const THREAD_LIFECYCLE_EVENT_PREDICATES: Record<
  ThreadLifecycleEventType,
  ThreadLifecycleSupersessionPredicates
> = {
  "turn.started": { notStopRequested: true },
  "turn.completed": {},
  "turn.failed": { notStopRequested: true },
  "turn.interrupted": {},
  "runtime.exited": { notStopRequested: true },
  "turn.dispatched": { notStopRequested: true },
  "reprovision.started": {},
  "start.succeeded": {
    notArchived: true,
    notDeleted: true,
    notStopRequested: true,
  },
  "command.failed": { notDeleted: true },
  "provision.failed": { notDeleted: true },
  "workspace.lost": { notArchived: true, notDeleted: true },
  "stop.completed": {},
  "session.lost": {},
  "runtime.observed-active": { notDeleted: true, notStopRequested: true },
};

/**
 * Behavior-neutral first pass: each cell encodes a (from, event, to) triple
 * observed at an existing transition call site (or permitted there by
 * `tryTransition` + ALLOWED_TRANSITIONS with no caller from-status guard).
 * Cells that look wrong are kept and marked `// observed:` — tightening is a
 * separate, reviewable follow-up. Absent cell = the event is a no-op in that
 * status (previously a swallowed InvalidThreadStatusTransitionError or a
 * caller guard skipping the write).
 */
export const THREAD_LIFECYCLE: Record<
  ThreadStatus,
  Partial<Record<ThreadLifecycleEventType, ThreadStatus>>
> = {
  created: {
    // observed: daemon turn events can land before thread.start settles, so a
    // pre-start thread activates (or idles) straight from "created".
    "turn.started": "active",
    "turn.completed": "idle",
    "turn.failed": "error",
    "turn.interrupted": "idle",
    "runtime.exited": "error",
    "start.succeeded": "active",
    "command.failed": "error",
    // observed: environment-level provision failure errors every live thread
    // bound to the environment regardless of its own status.
    "provision.failed": "error",
    "workspace.lost": "error",
    // observed: stop finalize moves a never-started thread to "idle" rather
    // than back to "created".
    "stop.completed": "idle",
    "session.lost": "error",
    "runtime.observed-active": "active",
  },
  provisioning: {
    "turn.started": "active",
    // observed: turn completion while still provisioning skips activation.
    "turn.completed": "idle",
    "turn.failed": "error",
    "turn.interrupted": "idle",
    "runtime.exited": "error",
    "start.succeeded": "active",
    "command.failed": "error",
    "provision.failed": "error",
    "workspace.lost": "error",
    "stop.completed": "idle",
    "session.lost": "error",
    "runtime.observed-active": "active",
  },
  idle: {
    "turn.started": "active",
    // observed: turn/runtime failures arriving while idle flip the thread to
    // "error" even though no turn is active.
    "turn.failed": "error",
    "runtime.exited": "error",
    "turn.dispatched": "active",
    "reprovision.started": "provisioning",
    "start.succeeded": "active",
    "command.failed": "error",
    // observed: environment-level provision failure (see "created").
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
    // observed: environment-level provision failure (see "created").
    "provision.failed": "error",
    "workspace.lost": "error",
    "stop.completed": "idle",
    "session.lost": "error",
  },
  error: {
    "turn.started": "active",
    "turn.completed": "idle",
    "turn.interrupted": "idle",
    // observed: errored threads activate optimistically when a turn is
    // dispatched, before any daemon acknowledgement.
    "turn.dispatched": "active",
    // observed: callers additionally require that the errored thread never
    // started (no provider thread id) — an event-log condition the row cannot
    // express; it stays at the caller.
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
  stopRequestedAt: number | null;
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
 * deleted/stopped thread reports "superseded" even when the current status
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
  if (predicates.notStopRequested && thread.stopRequestedAt !== null) {
    return { noop: "superseded", detail: "stopRequestedAt set" };
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
