/**
 * THREAD LIFECYCLE — the designed two-axis model.
 *
 * This is no longer the behavior-neutral inventory of the original migration:
 * stop intent is now the `stopping` *status*, not a `stopRequestedAt`
 * side-field. The two axes are:
 *
 * - Execution status (one column): created → provisioning → active →
 *   stopping → idle | error. Both the "working" intent (`active`) and the
 *   "stopping" intent (`stopping`) are real states here.
 * - Record fields (orthogonal): deletedAt, archivedAt — surfaced as the only
 *   supersession predicates (`notDeleted`, `notArchived`).
 *
 * `stop.requested` (active/created/provisioning → stopping) replaces the old
 * `markThreadStopRequested` field write. A `stopping` row has NO
 * turn.dispatched / turn.started / start.succeeded / runtime.observed-active
 * cell: dispatching new work into it is structurally impossible, which is the
 * table form of the old `notStopRequested` guard. A settled stop lands on
 * `idle` (stop.completed / turn.completed / turn.interrupted / session.lost) or
 * `error` (turn.failed / runtime.exited / etc). THREAD_LIFECYCLE and
 * THREAD_LIFECYCLE_EVENT_PREDICATES in src/thread-lifecycle.ts are the source
 * of truth; these assertions pin them.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateThreadLifecycleEvent,
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
  type ThreadLifecycleEventType,
  type ThreadLifecycleRowState,
} from "../src/thread-lifecycle.js";
import {
  threadStatusValues,
  type ThreadStatus,
} from "../src/thread-status.js";

const allEventTypes: readonly ThreadLifecycleEventType[] = [
  "turn.started",
  "turn.completed",
  "turn.failed",
  "turn.interrupted",
  "runtime.exited",
  "turn.dispatched",
  "reprovision.started",
  "start.succeeded",
  "command.failed",
  "provision.failed",
  "workspace.lost",
  "stop.requested",
  "stop.completed",
  "session.lost",
  "runtime.observed-active",
];

function rowState(
  status: ThreadStatus,
  overrides?: Partial<Omit<ThreadLifecycleRowState, "status">>,
): ThreadLifecycleRowState {
  return {
    archivedAt: null,
    deletedAt: null,
    status,
    ...overrides,
  };
}

function statusWithCell(eventType: ThreadLifecycleEventType): ThreadStatus {
  const status = threadStatusValues.find(
    (candidate) => THREAD_LIFECYCLE[candidate][eventType] !== undefined,
  );
  if (!status) {
    throw new Error(`No table cell found for event ${eventType}`);
  }
  return status;
}

describe("THREAD_LIFECYCLE table", () => {
  it("covers every thread status", () => {
    expect(Object.keys(THREAD_LIFECYCLE).sort()).toEqual(
      [...threadStatusValues].sort(),
    );
  });

  it("declares predicates for every event type", () => {
    expect([...allEventTypes].sort()).toEqual(
      Object.keys(THREAD_LIFECYCLE_EVENT_PREDICATES).sort(),
    );
  });

  it("matches the designed two-axis transitions exactly", () => {
    expect(THREAD_LIFECYCLE).toEqual({
      created: {
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
        "stop.requested": "stopping",
        "session.lost": "error",
      },
      stopping: {
        "stop.completed": "idle",
        "turn.completed": "idle",
        "turn.interrupted": "idle",
        "turn.failed": "error",
        "runtime.exited": "error",
        "provision.failed": "error",
        "workspace.lost": "error",
        "command.failed": "error",
        "session.lost": "idle",
      },
      error: {
        "turn.started": "active",
        "turn.completed": "idle",
        "turn.interrupted": "idle",
        "turn.dispatched": "active",
        "reprovision.started": "provisioning",
        "start.succeeded": "active",
        "runtime.observed-active": "active",
      },
    });
  });

  it("matches the designed predicates exactly", () => {
    expect(THREAD_LIFECYCLE_EVENT_PREDICATES).toEqual({
      "turn.started": {},
      "turn.completed": {},
      "turn.failed": {},
      "turn.interrupted": {},
      "runtime.exited": {},
      "turn.dispatched": { notArchived: true, notDeleted: true },
      "reprovision.started": {},
      "start.succeeded": {
        notArchived: true,
        notDeleted: true,
      },
      "command.failed": { notDeleted: true },
      "provision.failed": { notDeleted: true },
      "workspace.lost": { notArchived: true, notDeleted: true },
      "stop.requested": {},
      "stop.completed": {},
      "session.lost": {},
      "runtime.observed-active": { notDeleted: true },
    });
  });

  it("never maps a status onto itself", () => {
    for (const status of threadStatusValues) {
      for (const eventType of allEventTypes) {
        expect(THREAD_LIFECYCLE[status][eventType]).not.toBe(status);
      }
    }
  });
});

describe("evaluateThreadLifecycleEvent", () => {
  it("applies every table cell on a clean row", () => {
    for (const status of threadStatusValues) {
      for (const eventType of allEventTypes) {
        const to = THREAD_LIFECYCLE[status][eventType];
        if (to === undefined) {
          continue;
        }
        expect(
          evaluateThreadLifecycleEvent({
            event: { type: eventType },
            thread: rowState(status),
          }),
        ).toEqual({ to });
      }
    }
  });

  it("no-ops as illegal-transition for every absent cell on a clean row", () => {
    for (const status of threadStatusValues) {
      for (const eventType of allEventTypes) {
        if (THREAD_LIFECYCLE[status][eventType] !== undefined) {
          continue;
        }
        expect(
          evaluateThreadLifecycleEvent({
            event: { type: eventType },
            thread: rowState(status),
          }),
        ).toEqual({
          noop: "illegal-transition",
          detail: `no transition for ${eventType} from status ${status}`,
        });
      }
    }
  });

  it("supersedes or ignores each staleness signal exactly as declared", () => {
    const signals = [
      {
        detail: "deletedAt set",
        flag: "notDeleted",
        overrides: { deletedAt: 1_000 },
      },
      {
        detail: "archivedAt set",
        flag: "notArchived",
        overrides: { archivedAt: 1_000 },
      },
    ] as const;

    for (const eventType of allEventTypes) {
      const predicates = THREAD_LIFECYCLE_EVENT_PREDICATES[eventType];
      const status = statusWithCell(eventType);
      for (const signal of signals) {
        const evaluation = evaluateThreadLifecycleEvent({
          event: { type: eventType },
          thread: rowState(status, signal.overrides),
        });
        if (predicates[signal.flag]) {
          expect(evaluation).toEqual({
            noop: "superseded",
            detail: signal.detail,
          });
        } else {
          // Behavior parity: undeclared signals must not block the event.
          expect(evaluation).toEqual({
            to: THREAD_LIFECYCLE[status][eventType],
          });
        }
      }
    }
  });

  it("settles a stopping thread to idle when its turn completes on its own", () => {
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "turn.completed" },
        thread: rowState("stopping"),
      }),
    ).toEqual({ to: "idle" });
  });

  it("does not reactivate a stopping thread on dispatched/started work", () => {
    for (const eventType of [
      "turn.dispatched",
      "turn.started",
      "start.succeeded",
      "runtime.observed-active",
    ] as const) {
      expect(
        evaluateThreadLifecycleEvent({
          event: { type: eventType },
          thread: rowState("stopping"),
        }),
      ).toEqual({
        noop: "illegal-transition",
        detail: `no transition for ${eventType} from status stopping`,
      });
    }
  });

  it("reports superseded before illegal-transition", () => {
    // start.succeeded has no cell for "active", but the deleted row must win.
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "start.succeeded" },
        thread: rowState("active", { deletedAt: 1_000 }),
      }),
    ).toEqual({ noop: "superseded", detail: "deletedAt set" });
  });

  it("checks deleted, then archived", () => {
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "start.succeeded" },
        thread: rowState("created", {
          archivedAt: 1_000,
          deletedAt: 1_000,
        }),
      }),
    ).toEqual({ noop: "superseded", detail: "deletedAt set" });
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "start.succeeded" },
        thread: rowState("created", {
          archivedAt: 1_000,
        }),
      }),
    ).toEqual({ noop: "superseded", detail: "archivedAt set" });
  });
});
