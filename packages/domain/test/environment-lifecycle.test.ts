/**
 * ENVIRONMENT LIFECYCLE INVENTORY (step 5 of plans/server-lifecycle-transition-core.md)
 *
 * Every environment-status transition call site, classified.
 * ENVIRONMENT_LIFECYCLE and ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES in
 * src/environment-lifecycle.ts are derived from — and behavior-neutral with
 * respect to — this inventory. Environments had no transition table before
 * this work, so "any" in the from column means the write was completely
 * unguarded: every from-status was permitted and is recorded as a cell
 * (`// observed:` marks the ones that look wrong).
 *
 * ## Status write sites (8 in packages/db/src/data/environments.ts pre-change)
 *
 * | # | Site | from → to | Event | Guards observed |
 * |---|------|-----------|-------|-----------------|
 * | 1 | createEnvironment:61 | (creation default) | — | stays as-is |
 * | 2 | setEnvironmentStatus via requestEnvironmentProvisioning (environment-provisioning-internal.ts:816) | any-non-provisioning → provisioning | provision.requested | status !== provisioning only. Callers: thread-provisioning-environment.ts:647 (env created in same tx as "provisioning" — provably a no-op, call deleted), :978 (reused checkout-unmanaged env), :1082 (prepared env), dispatchManagedEnvironmentReprovision:1059 (guards only in-progress provisioning) |
 * | 3 | setEnvironmentStatus via restoreProvisioningEnvironmentAfterCancelledProvisioningOutcomeInTransaction (:425) | provisioning → ready\|error by path | provision.cancelled | status === destroyed returns false first (routing, stays caller-side); status === provisioning |
 * | 4 | setEnvironmentStatus via recordEnvironmentProvisioningFailureInTransaction (:500) | provisioning/ready/destroying → error | provision.failed | status !== destroyed && status !== error |
 * | 5 | setEnvironmentStatus, initiator-less provision settlement (:542) | any → error | provision.failed | UNGUARDED (see suspicious list) |
 * | 6 | setEnvironmentStatus via settleEnvironmentProvisionCancelCommandResult (:782) | provisioning → ready\|error by path | provision.cancelled | status === provisioning |
 * | 7 | setEnvironmentStatus via restoreEnvironmentAfterCleanupCancellation (environment-cleanup-internal.ts:209) | destroying → ready\|error | — | DEAD CODE: the only caller returns "in_progress" before reaching it whenever status is destroying; deleted |
 * | 8 | applyProvisionedEnvironmentRecord (:357) via provision settle ok (:561) | any → ready | provision.succeeded | UNGUARDED; merged metadata+status in one update — split into recordProvisionedEnvironmentWorkspace + lifecycle event per AGENTS.md |
 * | 9 | claimEnvironmentDestroy (:498) via advanceEnvironmentCleanup (:483) | ready → destroying | destroy.dispatched | SQL: managed, cleanupRequestedAt NOT NULL, path NOT NULL, no live threads, no stop-requested threads (cross-table NOT EXISTS stay in the db writer's CAS); stamps destroyAttemptId |
 * | 10 | restoreEnvironmentAfterDestroyAttemptFailure (:541) via destroy settle failure (:255) | destroying → ready\|error by path | destroy.failed | caller + SQL: status === destroying, destroyAttemptId match (→ matchingDestroyAttempt); clears destroyAttemptId |
 * | 11 | setEnvironmentRecordDestroyed (:456) via destroy settle ok (:273) | destroying → destroyed | destroy.succeeded | caller: status === destroying; status === destroyed proceeds without a write (idempotent re-settlement routing, stays caller-side); clears cleanup fields + destroyAttemptId |
 * | 12 | setEnvironmentRecordDestroyed via advanceEnvironmentCleanup pathless branch (:448) | ready/error/destroying → destroyed | cleanup.completed | managed; destroy requested (cleanupMode set or status destroying); no live threads; no pending shutdown; path NULL; status !== provisioning/destroyed |
 * | 13 | recoverStaleDestroyingEnvironmentCleanup (:580) | destroying → ready (path) / destroyed (no path) | destroy.lost | SQL: managed, status destroying, cleanupRequestedAt NOT NULL, stale updatedAt (staleness selection stays a sweep read); clears destroyAttemptId |
 * | 14 | claimManagedEnvironmentReprovisionRecord (:640) | any-non-provisioning → provisioning | — | DEAD CODE: no production callers; deleted |
 *
 * ## Status-guard sweep: environment.status reads across apps/server (~50 hits)
 *
 * (a) Becomes a table cell, predicate, or writer CAS — 8 (deleted with the
 * migration):
 *   environment-provisioning-internal.ts:433 (provision.cancelled cell),
 *   :500 destroyed/error exclusion (provision.failed cells), :782
 *   (provision.cancelled cell), :824 (provision.requested: absent
 *   provisioning cell); environment-cleanup-internal.ts:254 (destroy.failed
 *   cell + matchingDestroyAttempt), :272 (destroy.succeeded cell), :444
 *   pathless provisioning skip (cleanup.completed: absent provisioning
 *   cell); plus claimEnvironmentDestroy's SQL from-status (destroy.dispatched
 *   cell).
 *
 * (b) Non-lifecycle; stays — ~40:
 *   Flow gates and routing: environment-cleanup-internal.ts:157 (preflight
 *   precondition), :205 (isDestroyRequested intent read), :340 (cancel
 *   returns "in_progress"), :422 (advance gate), :460 (post-await staleness
 *   recheck kept as a stronger caller-side guard);
 *   environment-provisioning-internal.ts:429 (destroyed → return false
 *   routing), :734 (log field), :836 (interrupt flow gate), :928 (advance
 *   gate), :975 (in-progress read);
 *   environment-provisioning-cancellation.ts:61 (routing read).
 *   Boundary validation / reads elsewhere: workspace-command-target.ts:37,
 *   services/lib/entity-lookup.ts:206, services/lib/lifecycle-api-errors.ts:38,62,
 *   routes/threads/base.ts:222, internal/environment-changes.ts:36,
 *   projects/project-deletion.ts:108,193, scheduling/thread-schedule-sweep.ts:471,
 *   system/periodic-sweeps.ts:433, threads/parent-system-messages.ts:260,320,
 *   threads/thread-create.ts:163,180,312,313,317,320,
 *   threads/thread-provisioning.ts:122,130,133,137,170,
 *   threads/thread-commands.ts:418,469, threads/provider-command-typeahead.ts:77,
 *   threads/thread-provisioning-environment.ts:1169,1181,1197,1201,1252,1326,1339.
 *
 * (c) Suspicious/unclear — 6:
 *   environment-provisioning-internal.ts:542 — an initiator-less provision
 *     settlement forced error from ANY status, including destroyed/error.
 *     Every server-side command builder sets the initiator (only the contract
 *     type is nullable), so the branch is unreachable in practice. Migrated
 *     to provision.failed; destroyed/error are no longer forced to error.
 *   environment-cleanup-internal.ts:209 — restoreEnvironmentAfterCleanupCancellation
 *     was unreachable (see write site 7); deleted.
 *   claimManagedEnvironmentReprovisionRecord — dead db function; deleted.
 *   thread-provisioning-environment.ts:647 — requestEnvironmentProvisioning
 *     on an environment created with status "provisioning" in the same
 *     transaction; provably a no-op, call deleted.
 *   destroyed → provisioning / destroyed → ready cells — unguarded sites
 *     permit resurrecting a destroyed record; kept as observed cells.
 *   provision.requested from destroying — leaves the stale destroyAttemptId
 *     in place; kept as observed.
 *
 * Supersession/intent columns: cleanupRequestedAt + cleanupMode (destroy
 * intent), destroyAttemptId (per-attempt staleness token), managed, path.
 * Daemon-session staleness on environment paths is only the
 * hasConnectedHostDaemon lease check — a flow precondition, not a row
 * signal; environment settlements rely on destroyAttemptId and the status
 * CAS rather than a daemon instanceId.
 */
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
  "destroy.dispatched",
  "destroy.succeeded",
  "destroy.failed",
  "destroy.lost",
  "cleanup.completed",
];

const payloadEventTypes: readonly EnvironmentLifecycleEventType[] = [
  "destroy.dispatched",
  "destroy.failed",
];

function eventOfType(
  eventType: EnvironmentLifecycleEventType,
): EnvironmentLifecycleEvent {
  switch (eventType) {
    case "destroy.dispatched":
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
    cleanupRequestedAt: null,
    destroyAttemptId: null,
    managed: false,
    path: null,
    status,
    ...overrides,
  };
}

/**
 * A row that satisfies every predicate the event declares, so table-cell
 * evaluation is exercised without supersession interference.
 */
function eligibleRowState(
  eventType: EnvironmentLifecycleEventType,
  status: EnvironmentStatus,
  overrides?: Partial<Omit<EnvironmentLifecycleRowState, "status">>,
): EnvironmentLifecycleRowState {
  const predicates = ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES[eventType];
  return rowState(status, {
    ...(predicates.cleanupRequested ? { cleanupRequestedAt: 1_000 } : {}),
    ...(predicates.managed ? { managed: true } : {}),
    ...(predicates.workspacePathPresent ? { path: "/tmp/workspace" } : {}),
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

  it("matches the inventoried transitions exactly", () => {
    expect(ENVIRONMENT_LIFECYCLE).toEqual({
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
        "provision.failed": "error",
        "destroy.dispatched": "destroying",
        "cleanup.completed": "destroyed",
      },
      error: {
        "provision.requested": "provisioning",
        "provision.succeeded": "ready",
        "cleanup.completed": "destroyed",
      },
      destroying: {
        "provision.requested": "provisioning",
        "provision.succeeded": "ready",
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
        "cleanup.completed": "destroyed",
      },
      destroyed: {
        "provision.requested": "provisioning",
        "provision.succeeded": "ready",
      },
    });
  });

  it("matches the inventoried predicates exactly", () => {
    expect(ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES).toEqual({
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

  it("never maps a status onto itself", () => {
    for (const status of environmentStatusValues) {
      for (const eventType of allEventTypes) {
        const target = ENVIRONMENT_LIFECYCLE[status][eventType];
        if (target === undefined) {
          continue;
        }
        if (typeof target === "string") {
          expect(target).not.toBe(status);
        } else {
          expect(target.withWorkspacePath).not.toBe(status);
          expect(target.withoutWorkspacePath).not.toBe(status);
        }
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

  it("resolves path-dependent targets by workspace path", () => {
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
    ).toEqual({ to: "error" });
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("destroying", { cleanupRequestedAt: 1_000 }),
        event: { type: "destroy.lost" },
      }),
    ).toEqual({ to: "destroyed" });
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("destroying", {
          cleanupRequestedAt: 1_000,
          path: "/tmp/workspace",
        }),
        event: { type: "destroy.lost" },
      }),
    ).toEqual({ to: "ready" });
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

  it("supersedes or ignores each row signal exactly as declared", () => {
    const signals = [
      {
        breakRow: { managed: false },
        detail: "environment is not managed",
        flag: "managed",
      },
      {
        breakRow: { cleanupRequestedAt: null },
        detail: "cleanupRequestedAt cleared",
        flag: "cleanupRequested",
      },
      {
        breakRow: { path: null },
        detail: "workspace path missing",
        flag: "workspacePathPresent",
      },
      {
        breakRow: { path: "/tmp/workspace" },
        detail: "workspace path present",
        flag: "workspacePathAbsent",
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
        if (
          !predicates[signal.flag] &&
          (signal.flag === "workspacePathPresent" ||
            signal.flag === "workspacePathAbsent")
        ) {
          // Path-dependent targets make path overrides change the target
          // status without superseding; covered by the byPath test above.
          continue;
        }
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
          // Behavior parity: undeclared signals must not block the event.
          expect(evaluation).toEqual({
            to: expectedTarget(eventType, status, environment),
          });
        }
      }
    }
  });

  it("applies destroy.failed when the attempt id matches the row", () => {
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("destroying", {
          destroyAttemptId: "rpc_attempt",
          path: "/tmp/workspace",
        }),
        event: { type: "destroy.failed", destroyAttemptId: "rpc_attempt" },
      }),
    ).toEqual({ to: "ready" });
  });

  it("reports superseded before illegal-transition", () => {
    // destroy.failed has no cell for "ready", but the stale attempt id must
    // win so the no-op is observable as supersession.
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("ready", { destroyAttemptId: "rpc_current" }),
        event: { type: "destroy.failed", destroyAttemptId: "rpc_stale" },
      }),
    ).toEqual({ noop: "superseded", detail: "destroyAttemptId mismatch" });
  });

  it("checks managed, then cleanup intent, then workspace path", () => {
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("ready"),
        event: { type: "destroy.dispatched", destroyAttemptId: "rpc_attempt" },
      }),
    ).toEqual({ noop: "superseded", detail: "environment is not managed" });
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("ready", { managed: true }),
        event: { type: "destroy.dispatched", destroyAttemptId: "rpc_attempt" },
      }),
    ).toEqual({ noop: "superseded", detail: "cleanupRequestedAt cleared" });
    expect(
      evaluateEnvironmentLifecycleEvent({
        environment: rowState("ready", {
          cleanupRequestedAt: 1_000,
          managed: true,
        }),
        event: { type: "destroy.dispatched", destroyAttemptId: "rpc_attempt" },
      }),
    ).toEqual({ noop: "superseded", detail: "workspace path missing" });
  });
});
