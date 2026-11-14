import type { ThreadStatus } from "./thread-status.js";

export type ThreadStatusMove =
  | "run.preparing"
  | "run.started"
  | "run.succeeded"
  | "run.failed"
  | "stop.requested"
  | "stop.settled";

interface ThreadLifecycleSupersessionPredicates {
  notArchived?: true;
  notDeleted?: true;
}

export const THREAD_LIFECYCLE_EVENT_PREDICATES: Record<
  ThreadStatusMove,
  ThreadLifecycleSupersessionPredicates
> = {
  "run.preparing": { notArchived: true, notDeleted: true },
  "run.started": { notArchived: true, notDeleted: true },
  "run.succeeded": {},
  "run.failed": { notDeleted: true },
  "stop.requested": {},
  "stop.settled": {},
};

export const THREAD_LIFECYCLE: Record<
  ThreadStatus,
  Partial<Record<ThreadStatusMove, ThreadStatus>>
> = {
  // A thread that has never dispatched. `run.preparing` is the one way out:
  // it is emitted when the first message's dispatch attempt clears every
  // wait, and `starting` then absorbs provisioning and session start exactly
  // as it does for a thread that has run before. There is deliberately no
  // `run.started` cell — a pending thread has no session for a turn to start
  // in, so a turn event arriving here is a bug, not a shortcut. There is no
  // `run.failed` cell either: an attempt that a gate rejects fails the send
  // and leaves the thread pending and unprovisioned, exactly where it was.
  // Archival and deletion are the orthogonal record dimensions and stay legal
  // from here without a cell, as they do from every status.
  pending: {
    "run.preparing": "starting",
  },
  idle: {
    "run.preparing": "starting",
    "run.started": "active",
  },
  starting: {
    "run.started": "active",
    "run.succeeded": "idle",
    "run.failed": "error",
    "stop.requested": "stopping",
  },
  active: {
    "run.succeeded": "idle",
    "run.failed": "error",
    "stop.requested": "stopping",
    "stop.settled": "idle",
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
