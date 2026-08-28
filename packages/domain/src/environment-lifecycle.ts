import type { EnvironmentStatus } from "./environment.js";

export type EnvironmentLifecycleEvent =
  | { type: "provision.requested" }
  | { type: "provision.succeeded" }
  | { type: "provision.failed" }
  | { type: "provision.cancelled" }
  | { type: "retire.requested" }
  | { type: "retire.cancelled" }
  | { type: "destroy.started"; destroyAttemptId: string }
  | { type: "destroy.completed"; destroyAttemptId: string | null }
  | { type: "destroy.failed"; destroyAttemptId: string }
  | { type: "destroy.lost" };

export type EnvironmentLifecycleEventType = EnvironmentLifecycleEvent["type"];

interface EnvironmentLifecycleSupersessionPredicates {
  managed?: true;
  matchingDestroyAttempt?: true;
}

type EnvironmentLifecycleEventPredicateTable = Record<
  EnvironmentLifecycleEventType,
  EnvironmentLifecycleSupersessionPredicates
>;

function defineEnvironmentLifecycleEventPredicateTable(
  table: EnvironmentLifecycleEventPredicateTable,
): EnvironmentLifecycleEventPredicateTable {
  return table;
}

export const ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES =
  defineEnvironmentLifecycleEventPredicateTable({
    "provision.requested": {},
    "provision.succeeded": {},
    "provision.failed": {},
    "provision.cancelled": {},
    "retire.requested": { managed: true },
    "retire.cancelled": {},
    "destroy.started": { managed: true },
    "destroy.completed": { matchingDestroyAttempt: true },
    "destroy.failed": { matchingDestroyAttempt: true },
    "destroy.lost": {},
  });

export interface EnvironmentLifecyclePathDependentTarget {
  withWorkspacePath: EnvironmentStatus;
  withoutWorkspacePath: EnvironmentStatus;
}

type EnvironmentLifecycleTarget =
  | EnvironmentStatus
  | EnvironmentLifecyclePathDependentTarget;

type EnvironmentLifecycleTable = Record<
  EnvironmentStatus,
  Partial<Record<EnvironmentLifecycleEventType, EnvironmentLifecycleTarget>>
>;

function defineEnvironmentLifecycleTable(
  table: EnvironmentLifecycleTable,
): EnvironmentLifecycleTable {
  return table;
}

function isPathDependentTarget(
  target: EnvironmentLifecycleTarget,
): target is EnvironmentLifecyclePathDependentTarget {
  return Object.prototype.hasOwnProperty.call(target, "withWorkspacePath");
}

export const ENVIRONMENT_LIFECYCLE = defineEnvironmentLifecycleTable({
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
    "destroy.completed": "destroyed",
  },
  destroying: {
    "destroy.completed": "destroyed",
    "destroy.failed": "retiring",
    "destroy.lost": "error",
  },
  destroyed: {},
});

export interface EnvironmentLifecycleRowState {
  destroyAttemptId: string | null;
  managed: boolean;
  path: string | null;
  status: EnvironmentStatus;
}

export type EnvironmentLifecycleNoopReason =
  | "illegal-transition"
  | "superseded";

type EnvironmentLifecycleEvaluation =
  | { to: EnvironmentStatus }
  | { noop: EnvironmentLifecycleNoopReason; detail: string };

interface EvaluateEnvironmentLifecycleEventArgs {
  environment: EnvironmentLifecycleRowState;
  event: EnvironmentLifecycleEvent;
}

export function evaluateEnvironmentLifecycleEvent(
  args: EvaluateEnvironmentLifecycleEventArgs,
): EnvironmentLifecycleEvaluation {
  const { environment, event } = args;
  const predicates = ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES[event.type];
  if (predicates.managed && !environment.managed) {
    return { noop: "superseded", detail: "environment is not managed" };
  }
  if (
    predicates.matchingDestroyAttempt &&
    "destroyAttemptId" in event &&
    event.destroyAttemptId !== environment.destroyAttemptId
  ) {
    return { noop: "superseded", detail: "destroyAttemptId mismatch" };
  }

  const target = ENVIRONMENT_LIFECYCLE[environment.status][event.type];
  if (target === undefined) {
    return {
      noop: "illegal-transition",
      detail: `no transition for ${event.type} from status ${environment.status}`,
    };
  }
  if (isPathDependentTarget(target)) {
    return {
      to:
        environment.path !== null
          ? target.withWorkspacePath
          : target.withoutWorkspacePath,
    };
  }
  return { to: target };
}
