import type { EnvironmentStatus } from "./environment.js";

/**
 * What happened to an environment, in product terms. Callers report events
 * instead of choosing target statuses; ENVIRONMENT_LIFECYCLE maps
 * (status, event) → next status and ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES
 * declares which row-level signals supersede each event.
 *
 * Unlike thread events, two destroy events carry a `destroyAttemptId`
 * payload: the db writer stamps it on dispatch and the evaluator compares it
 * on failure settlement, replacing the old per-attempt CAS in
 * restoreEnvironmentAfterDestroyAttemptFailure.
 *
 * Vocabulary (sources are the call sites inventoried in
 * packages/domain/test/environment-lifecycle.test.ts):
 * - `provision.requested` — server requested (re)provisioning of an existing
 *   environment record (checkout reuse, prepared env, managed reprovision).
 * - `provision.succeeded` — environment.provision RPC settled ok.
 * - `provision.failed` — provisioning failed (RPC failure, interrupted
 *   recovery, or an initiator-less settlement).
 * - `provision.cancelled` — provisioning was abandoned because every
 *   dependent thread stopped or cancelled; the environment returns to its
 *   settled state (ready with a workspace, error without one).
 * - `destroy.dispatched` — the cleanup advance claimed the environment for a
 *   destroy RPC (stamps destroyAttemptId).
 * - `destroy.succeeded` — environment.destroy RPC settled ok.
 * - `destroy.failed` — environment.destroy RPC failed; the matching attempt
 *   restores the settled state.
 * - `destroy.lost` — the sweep recovered a stale destroying row whose RPC
 *   result was lost (restores with a workspace, finalizes without one).
 * - `cleanup.completed` — requested cleanup finished without a destroy RPC
 *   because the environment has no workspace path to remove.
 */
export type EnvironmentLifecycleEvent =
  | { type: "provision.requested" }
  | { type: "provision.succeeded" }
  | { type: "provision.failed" }
  | { type: "provision.cancelled" }
  | { type: "destroy.dispatched"; destroyAttemptId: string }
  | { type: "destroy.succeeded" }
  | { type: "destroy.failed"; destroyAttemptId: string }
  | { type: "destroy.lost" }
  | { type: "cleanup.completed" };

export type EnvironmentLifecycleEventType = EnvironmentLifecycleEvent["type"];

/**
 * Declarative supersession predicates: row-level signals that turn an
 * otherwise-legal event into a "superseded" no-op. A flag is present only
 * when every call site of the event observed today guards on that signal —
 * stronger per-caller guards stay at the caller until the migration tightens
 * them deliberately.
 *
 * `matchingDestroyAttempt` reads the event's `destroyAttemptId` payload and
 * may only be declared on events that carry one.
 */
export interface EnvironmentLifecycleSupersessionPredicates {
  cleanupRequested?: true;
  managed?: true;
  matchingDestroyAttempt?: true;
  workspacePathAbsent?: true;
  workspacePathPresent?: true;
}

export const ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES: Record<
  EnvironmentLifecycleEventType,
  EnvironmentLifecycleSupersessionPredicates
> = {
  "provision.requested": {},
  "provision.succeeded": {},
  "provision.failed": {},
  "provision.cancelled": {},
  "destroy.dispatched": {
    cleanupRequested: true,
    managed: true,
    workspacePathPresent: true,
  },
  "destroy.succeeded": {},
  "destroy.failed": { matchingDestroyAttempt: true },
  "destroy.lost": { cleanupRequested: true },
  "cleanup.completed": {
    cleanupRequested: true,
    managed: true,
    workspacePathAbsent: true,
  },
};

/**
 * Some events return the environment to its settled state, which depends on
 * whether a workspace exists on disk: ready with a path, error (or destroyed
 * for the lost-destroy sweep) without one. The evaluator resolves the branch
 * against the row's `path`.
 */
export interface EnvironmentLifecyclePathDependentTarget {
  withWorkspacePath: EnvironmentStatus;
  withoutWorkspacePath: EnvironmentStatus;
}

export type EnvironmentLifecycleTarget =
  | EnvironmentStatus
  | EnvironmentLifecyclePathDependentTarget;

/**
 * Behavior-neutral first pass: each cell encodes a (from, event, to) triple
 * observed at an existing transition call site (or permitted there because
 * the site had no from-status guard at all). Cells that look wrong are kept
 * and marked `// observed:` — tightening is a separate, reviewable follow-up.
 * Absent cell = the event is a no-op in that status (previously a caller
 * guard skipping the write).
 */
export const ENVIRONMENT_LIFECYCLE: Record<
  EnvironmentStatus,
  Partial<Record<EnvironmentLifecycleEventType, EnvironmentLifecycleTarget>>
> = {
  provisioning: {
    "provision.succeeded": "ready",
    "provision.failed": "error",
    "provision.cancelled": {
      withWorkspacePath: "ready",
      withoutWorkspacePath: "error",
    },
  },
  ready: {
    "provision.requested": "provisioning",
    // observed: an environment-level provisioning failure errors a settled
    // ready environment (the failure recorder only excluded destroyed/error).
    "provision.failed": "error",
    "destroy.dispatched": "destroying",
    "cleanup.completed": "destroyed",
  },
  error: {
    "provision.requested": "provisioning",
    // observed: provision settlement is unguarded, so a late success revives
    // an errored environment.
    "provision.succeeded": "ready",
    "cleanup.completed": "destroyed",
  },
  destroying: {
    // observed: reprovision requests never excluded an in-flight destroy and
    // leave the stale destroyAttemptId in place.
    "provision.requested": "provisioning",
    // observed: unguarded provision settlement overrides an in-flight
    // destroy.
    "provision.succeeded": "ready",
    // observed: an environment-level provisioning failure also errors a
    // destroying environment (see "ready").
    "provision.failed": "error",
    "destroy.succeeded": "destroyed",
    "destroy.failed": {
      withWorkspacePath: "ready",
      withoutWorkspacePath: "error",
    },
    "destroy.lost": {
      withWorkspacePath: "ready",
      withoutWorkspacePath: "destroyed",
    },
    // observed: the pathless cleanup advance finalizes a destroying
    // environment directly, without a destroy RPC round trip.
    "cleanup.completed": "destroyed",
  },
  destroyed: {
    // observed: reprovision requests never excluded destroyed rows, so a
    // late request resurrects a destroyed record.
    "provision.requested": "provisioning",
    // observed: unguarded provision settlement resurrects a destroyed
    // record.
    "provision.succeeded": "ready",
  },
};

/** The environment-row fields supersession predicates evaluate against. */
export interface EnvironmentLifecycleRowState {
  cleanupRequestedAt: number | null;
  destroyAttemptId: string | null;
  managed: boolean;
  path: string | null;
  status: EnvironmentStatus;
}

export type EnvironmentLifecycleNoopReason =
  | "illegal-transition"
  | "superseded";

export type EnvironmentLifecycleEvaluation =
  | { to: EnvironmentStatus }
  | { noop: EnvironmentLifecycleNoopReason; detail: string };

export interface EvaluateEnvironmentLifecycleEventArgs {
  environment: EnvironmentLifecycleRowState;
  event: EnvironmentLifecycleEvent;
}

/**
 * Pure evaluation of a lifecycle event against a loaded environment row.
 * Supersession is checked before table lookup so a stale event on an
 * ineligible row reports "superseded" even when the current status has no
 * cell for it. Cross-table conditions (the destroy claim's "no live or
 * stop-requested threads") cannot be expressed on the row and live in the db
 * writer's compare-and-set instead.
 */
export function evaluateEnvironmentLifecycleEvent(
  args: EvaluateEnvironmentLifecycleEventArgs,
): EnvironmentLifecycleEvaluation {
  const { environment, event } = args;
  const predicates = ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES[event.type];
  if (predicates.managed && !environment.managed) {
    return { noop: "superseded", detail: "environment is not managed" };
  }
  if (predicates.cleanupRequested && environment.cleanupRequestedAt === null) {
    return { noop: "superseded", detail: "cleanupRequestedAt cleared" };
  }
  if (predicates.workspacePathPresent && environment.path === null) {
    return { noop: "superseded", detail: "workspace path missing" };
  }
  if (predicates.workspacePathAbsent && environment.path !== null) {
    return { noop: "superseded", detail: "workspace path present" };
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
  if (typeof target === "string") {
    return { to: target };
  }
  return {
    to:
      environment.path !== null
        ? target.withWorkspacePath
        : target.withoutWorkspacePath,
  };
}
