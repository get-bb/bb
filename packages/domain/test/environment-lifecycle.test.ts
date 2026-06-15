import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_LIFECYCLE,
  ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES,
  evaluateEnvironmentLifecycleEvent,
  type EnvironmentLifecycleEvent,
  type EnvironmentLifecycleEventType,
  type EnvironmentLifecycleRowState,
} from "../src/environment-lifecycle.js";
import {
  environmentStatusValues,
  type EnvironmentStatus,
} from "../src/environment.js";

const allEventTypes: readonly EnvironmentLifecycleEventType[] = [
  "provision.requested",
  "provision.succeeded",
  "provision.failed",
  "provision.cancelled",
  "retire.requested",
  "retire.cancelled",
  "destroy.started",
  "destroy.completed",
  "destroy.failed",
  "destroy.lost",
];

const payloadEventTypes: readonly EnvironmentLifecycleEventType[] = [
  "destroy.started",
  "destroy.failed",
];

function eventOfType(
  eventType: EnvironmentLifecycleEventType,
): EnvironmentLifecycleEvent {
  switch (eventType) {
    case "destroy.started":
    case "destroy.failed":
      return { type: eventType, destroyAttemptId: "rpc_attempt" };
    default:
      return { type: eventType };
  }
}

function rowState(
  status: EnvironmentStatus,
  overrides?: Partial<Omit<EnvironmentLifecycleRowState, "status">>,
): EnvironmentLifecycleRowState {
  return {
    destroyAttemptId: null,
    managed: false,
    path: null,
    status,
    ...overrides,
  };
}

function eligibleRowState(
  eventType: EnvironmentLifecycleEventType,
  status: EnvironmentStatus,
  overrides?: Partial<Omit<EnvironmentLifecycleRowState, "status">>,
): EnvironmentLifecycleRowState {
  const predicates = ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES[eventType];
  return rowState(status, {
    ...(predicates.managed ? { managed: true } : {}),
    ...(predicates.matchingDestroyAttempt
      ? { destroyAttemptId: "rpc_attempt" }
      : {}),
    ...overrides,
  });
}

function expectedTarget(
  eventType: EnvironmentLifecycleEventType,
  status: EnvironmentStatus,
  row: EnvironmentLifecycleRowState,
): EnvironmentStatus | undefined {
  const target = ENVIRONMENT_LIFECYCLE[status][eventType];
  if (target === undefined || typeof target === "string") {
    return target;
  }
  return row.path !== null
    ? target.withWorkspacePath
    : target.withoutWorkspacePath;
}

function statusWithCell(
  eventType: EnvironmentLifecycleEventType,
): EnvironmentStatus {
  const status = environmentStatusValues.find(
    (candidate) => ENVIRONMENT_LIFECYCLE[candidate][eventType] !== undefined,
  );
  if (!status) {
    throw new Error(`No table cell found for event ${eventType}`);
  }
  return status;
}

describe("ENVIRONMENT_LIFECYCLE table", () => {
  it("covers every environment status", () => {
    expect(Object.keys(ENVIRONMENT_LIFECYCLE).sort()).toEqual(
      [...environmentStatusValues].sort(),
    );
  });

  it("declares predicates for every event type", () => {
    expect([...allEventTypes].sort()).toEqual(
      Object.keys(ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES).sort(),
    );
  });

  it("matches the designed retiring-state transitions exactly", () => {
    expect(ENVIRONMENT_LIFECYCLE).toEqual({
      provisioning: {
        "provision.succeeded": "ready",
        "provision.failed": "error",
        "provision.cancelled": {
          withWorkspacePath: "ready",
          withoutWorkspacePath: "destroying",
        },
      },
      ready: {
        "provision.requested": "provisioning",
        "retire.requested": "retiring",
      },
      retiring: {
        "retire.cancelled": "ready",
        "destroy.started": "destroying",
      },
      error: {
        "provision.requested": "provisioning",
        "destroy.started": "destroying",
      },
      destroying: {
        "destroy.completed": "destroyed",
        "destroy.failed": "retiring",
        "destroy.lost": "error",
      },
      destroyed: {},
    });
  });

  it("matches the designed predicates exactly", () => {
    expect(ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES).toEqual({
      "provision.requested": {},
      "provision.succeeded": {},
      "provision.failed": {},
      "provision.cancelled": {},
      "retire.requested": { managed: true },
      "retire.cancelled": {},
      "destroy.started": { managed: true },
      "destroy.completed": {},
      "destroy.failed": { matchingDestroyAttempt: true },
      "destroy.lost": {},
    });
  });

  it("declares matchingDestroyAttempt only on events that carry the payload", () => {
    for (const eventType of allEventTypes) {
      const predicates = ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES[eventType];
      if (predicates.matchingDestroyAttempt) {
        expect(payloadEventTypes).toContain(eventType);
      }
    }
  });
});

describe("evaluateEnvironmentLifecycleEvent", () => {
  it("applies every table cell on an eligible row", () => {
    for (const status of environmentStatusValues) {
      for (const eventType of allEventTypes) {
        if (ENVIRONMENT_LIFECYCLE[status][eventType] === undefined) {
          continue;
        }
        const environment = eligibleRowState(eventType, status);
        expect(
          evaluateEnvironmentLifecycleEvent({
            environment,
            event: eventOfType(eventType),
          }),
        ).toEqual({ to: expectedTarget(eventType, status, environment) });
      }
    }
  });

  it("no-ops as illegal-transition for every absent cell on an eligible row", () => {
    for (const status of environmentStatusValues) {
      for (const eventType of allEventTypes) {
        if (ENVIRONMENT_LIFECYCLE[status][eventType] !== undefined) {
          continue;
        }
        expect(
          evaluateEnvironmentLifecycleEvent({
            environment: eligibleRowState(eventType, status),
            event: eventOfType(eventType),
          }),
        ).toEqual({
          noop: "illegal-transition",
          detail: `no transition for ${eventType} from status ${status}`,
        });
      }
    }
  });

  it("resolves path-dependent provision cancellation by workspace path", () => {
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("provisioning", { path: "/tmp/workspace" }),
        event: { type: "provision.cancelled" },
      }),
    ).toEqual({ to: "ready" });
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("provisioning"),
        event: { type: "provision.cancelled" },
      }),
    ).toEqual({ to: "destroying" });
  });

  it("supersedes or ignores each row signal exactly as declared", () => {
    const signals = [
      {
        breakRow: { managed: false },
        detail: "environment is not managed",
        flag: "managed",
      },
      {
        breakRow: { destroyAttemptId: "rpc_other_attempt" },
        detail: "destroyAttemptId mismatch",
        flag: "matchingDestroyAttempt",
      },
    ] as const;

    for (const eventType of allEventTypes) {
      const predicates = ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES[eventType];
      const status = statusWithCell(eventType);
      for (const signal of signals) {
        const environment = eligibleRowState(eventType, status, {
          ...signal.breakRow,
        });
        const evaluation = evaluateEnvironmentLifecycleEvent({
          environment,
          event: eventOfType(eventType),
        });
        if (predicates[signal.flag]) {
          expect(evaluation).toEqual({
            noop: "superseded",
            detail: signal.detail,
          });
        } else {
          expect(evaluation).toEqual({
            to: expectedTarget(eventType, status, environment),
          });
        }
      }
    }
  });

  it("reports superseded before illegal-transition", () => {
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("ready", { destroyAttemptId: "rpc_current" }),
        event: { type: "destroy.failed", destroyAttemptId: "rpc_stale" },
      }),
    ).toEqual({ noop: "superseded", detail: "destroyAttemptId mismatch" });
  });
});
