import { describe, expect, it } from "vitest";
import {
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
  type ThreadStatusMove,
} from "../src/thread-lifecycle.js";
import { threadStatusValues } from "../src/thread-status.js";

const allEventTypes: readonly ThreadStatusMove[] = [
  "run.preparing",
  "run.started",
  "run.succeeded",
  "run.failed",
  "stop.requested",
  "stop.settled",
];

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
        "run.succeeded": "idle",
        "run.failed": "error",
        "stop.settled": "idle",
      },
      error: {
        "run.preparing": "starting",
        "run.started": "active",
      },
    });
  });

  it("matches the designed predicates exactly", () => {
    expect(THREAD_LIFECYCLE_EVENT_PREDICATES).toEqual({
      "run.preparing": { notArchived: true, notDeleted: true },
      "run.started": { notArchived: true, notDeleted: true },
      "run.succeeded": {},
      "run.failed": { notDeleted: true },
      "stop.requested": {},
      "stop.settled": {},
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
