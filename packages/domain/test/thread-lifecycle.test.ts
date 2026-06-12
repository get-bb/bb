/**
 * THREAD LIFECYCLE INVENTORY (step 1 of plans/server-lifecycle-transition-core.md)
 *
 * Every thread-status transition call site, classified. THREAD_LIFECYCLE and
 * THREAD_LIFECYCLE_EVENT_PREDICATES in src/thread-lifecycle.ts are derived
 * from — and behavior-neutral with respect to — this inventory. "any" in the
 * from column means the site used tryTransition with no caller from-status
 * guard, so the observed froms are every status from which ALLOWED_TRANSITIONS
 * permits the target (illegal froms were silently swallowed). "THROWING"
 * marks sites using the throwing writer instead of a tryTransition shim.
 *
 * ## Transition call sites (19 sites; turn/completed splits into 3 events)
 *
 * | # | Site (apps/server/src/...) | from → to | Event | Guards observed |
 * |---|---------------------------|-----------|-------|-----------------|
 * | 1 | internal/events.ts:321 | created/provisioning/idle/error → active | turn.started | stopRequestedAt null (→ notStopRequested); !hasThreadStopBeforeTurnStarted(turnId) (event-log, stays caller-side); explicit from-status guard |
 * | 2 | internal/turn-completed-events.ts:42 ("completed") | created/provisioning/active/error → idle | turn.completed | explicit from-status guard; upstream events.ts:331 skips when a stop preceded the turn start (event-log, caller-side); no stopRequested/deletedAt guard |
 * | 3 | internal/turn-completed-events.ts:42 ("failed") | any → error | turn.failed | stopRequestedAt null (→ notStopRequested) |
 * | 4 | internal/turn-completed-events.ts:42 ("interrupted") | any → idle | turn.interrupted | none (interruption is itself the stop ack) |
 * | 5 | internal/events.ts:398 | any → error | runtime.exited | stopRequestedAt null (→ notStopRequested) |
 * | 6 | services/scheduling/thread-schedule-sweep.ts:628 | idle → active | turn.dispatched | prepare + in-tx recheck: notDeleted, notArchived, status idle/active, env unchanged; NO stopRequestedAt guard (see suspicious list) |
 * | 7 | services/environments/environment-cleanup-internal.ts:235 | any → error | workspace.lost | listLiveThreadsInEnvironment filters deletedAt/archivedAt (→ notDeleted, notArchived) |
 * | 8 | services/environments/environment-provisioning-internal.ts:524 | any → error | provision.failed | listLiveEnvironmentThreads filters deletedAt (→ notDeleted); shouldPreserveThreadProvisionCancellationOutcome excludes stop-cancelled threads (caller-side, provisioningId-scoped) |
 * | 9 | services/threads/thread-send.ts:447 | idle/error → active | turn.dispatched | route boundary throws for archived/stopping/deleted/active/pre-start; transitions when dispatch is turn.submit OR status is error; THROWING |
 * | 10 | services/threads/thread-turn-dispatch.ts:113 | idle/error → provisioning | reprovision.started | status idle, or status error AND no providerThreadId (event-log nuance, caller-side) |
 * | 11 | services/threads/queued-messages.ts:284 | idle → active | turn.dispatched | mode auto; status idle; provider thread exists; queued-message claim CAS; no in-tx thread recheck (see suspicious list) |
 * | 12 | services/threads/parent-system-messages.ts:348 | idle/error → active | turn.dispatched | parent exists, notArchived, notDeleted at queue entry; not pre-start; no stopRequested guard; THROWING |
 * | 13 | services/threads/thread-lifecycle.ts:505 | active → idle/error | stop.completed (manual-stop) / session.lost (host-daemon-restarted) | caller: status active && active turn exists; THROWING |
 * | 14 | services/threads/thread-lifecycle.ts:664 | any → error | command.failed | deletedAt null (→ notDeleted); !hasExpectedTurnCompletedEvent (event-log, caller-side) |
 * | 15 | services/threads/thread-lifecycle.ts:732 | created/provisioning/idle/error → active | start.succeeded | notDeleted, notArchived, notStopRequested (→ predicates); from-status guard; no interruption / provider turn-completed since command start (event-log, caller-side) |
 * | 16 | services/threads/thread-lifecycle.ts:1317 | active → error | session.lost | caller SQL: status active, deletedAt null, stopRequestedAt null; reason is always host-daemon-restarted; THROWING |
 * | 17 | services/threads/thread-lifecycle.ts:1428 | active → idle/error | stop.completed / session.lost | status active, no active turn; reason from latest interruption event |
 * | 18 | services/threads/thread-lifecycle.ts:1436 | created/provisioning → idle/error | stop.completed / session.lost | isPreStartThreadStatus |
 * | 19 | services/threads/thread-lifecycle.ts:1600 | error → active | runtime.observed-active | SQL: status error, deletedAt null, stopRequestedAt null, daemon reports thread active |
 * | 20 | services/threads/thread-lifecycle.ts:1658 | created/provisioning/idle → active | runtime.observed-active | SQL: notDeleted, notStopRequested; revival not blocked by latest host-daemon-restart interruption (event-log, caller-side) |
 * | 21 | services/threads/thread-provisioning-environment.ts:381 | provisioning → error | provision.failed | function unguarded; every caller guards status === provisioning + notDeleted (most also notArchived/notStopRequested) |
 *
 * ## Status-guard sweep: services/threads, 58 hits of `status !== / status ===`
 *
 * (a) Becomes an event predicate or a THREAD_LIFECYCLE from-status cell — 15:
 *   thread-turn-dispatch.ts:65 (error + no provider id → reprovision.started error cell),
 *   thread-turn-dispatch.ts:110 (idle → reprovision.started idle cell),
 *   queued-messages.ts:200 (auto-send only for idle → turn.dispatched from-status),
 *   thread-provisioning.ts:99 (provision-failure staleness: status !== provisioning),
 *   thread-provisioning.ts:289 (provision-advance staleness: status !== provisioning),
 *   thread-lifecycle.ts:626,627 (start.succeeded from-status),
 *   thread-lifecycle.ts:1418 (finalize picks interruption path when active → stop.completed/session.lost from-status),
 *   thread-send.ts:445 (error → active turn.dispatched cell),
 *   thread-provisioning-environment.ts:283,323,590,673,940,1049 (provision context staleness: status !== provisioning).
 *
 * (b) Non-lifecycle for thread events; leave alone — 42:
 *   environment.status guards (environment lifecycle, step 5, or dispatch
 *   preconditions): thread-turn-dispatch.ts:73,87,91; thread-create.ts:163,
 *   180,312,313,317,320; thread-provisioning.ts:122,130,133;
 *   thread-commands.ts:418,469; thread-provisioning-environment.ts:385,1166,
 *   1178,1194,1249,1323,1336; provider-command-typeahead.ts:77 (22 lines).
 *   API boundary validation (throws 4xx; requireApplied territory, not silent
 *   supersession): thread-send.ts:156,179 (2).
 *   Routing/event-selection that stays at callers: thread-send.ts:166,169,188
 *   (steer vs start vs auto); thread-send.ts:198 (host check for active
 *   sends); thread-lifecycle.ts:1073,1160,1194 (stop flavor routing);
 *   parent-system-messages.ts:298 (active vs ready dispatch path) (8).
 *   Read-path/display/other: thread-runtime-display.ts:72,111,127,135,199
 *   (72/135 are session.status); thread-lifecycle.ts:840 (completeThreadStart
 *   return value); thread-lifecycle.ts:517 (archive-forwarding precondition);
 *   parent-system-messages.ts:194 (in-tx steer staleness recheck — guards
 *   command dispatch, no transition); thread-turn-dispatch.ts:159 (result
 *   discriminant, not a status); thread-status.ts:11 (helper definition) (10).
 *
 * (c) Suspicious/unclear — 1 sweep hit + 3 call-site observations:
 *   thread-provisioning-environment.ts:460 — generated-title provider rename
 *     is forwarded only when the thread is active; renames are silently
 *     dropped for threads that finished quickly. Unclear why active is
 *     required.
 *   thread-schedule-sweep.ts:628 — schedule dispatch+activation has no
 *     stopRequestedAt guard anywhere on the path.
 *   queued-messages.ts:284 — the dispatch transaction never re-checks
 *     deletedAt/stopRequestedAt after claiming the queued message.
 *   thread-send.ts:447 — error → active is applied optimistically at
 *     dispatch, before any daemon acknowledgement (kept as an observed cell).
 *
 * Note for plan decision point 3: observed reality contradicts the plan's
 * assumption — internal/events.ts:313 SKIPS activation on turn/started when
 * stopRequestedAt is set, so turn.started carries notStopRequested.
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
    stopRequestedAt: null,
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

  it("matches the inventoried transitions exactly", () => {
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
        "stop.completed": "idle",
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
        "stop.completed": "idle",
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
        "stop.completed": "idle",
        "session.lost": "error",
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

  it("matches the inventoried predicates exactly", () => {
    expect(THREAD_LIFECYCLE_EVENT_PREDICATES).toEqual({
      "turn.started": { notStopRequested: true },
      "turn.completed": {},
      "turn.failed": { notStopRequested: true },
      "turn.interrupted": {},
      "runtime.exited": { notStopRequested: true },
      "turn.dispatched": {},
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
      {
        detail: "stopRequestedAt set",
        flag: "notStopRequested",
        overrides: { stopRequestedAt: 1_000 },
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

  it("keeps observed parity: turn.completed applies to a stop-requested active thread", () => {
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "turn.completed" },
        thread: rowState("active", { stopRequestedAt: 1_000 }),
      }),
    ).toEqual({ to: "idle" });
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

  it("checks deleted, then archived, then stop-requested", () => {
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "start.succeeded" },
        thread: rowState("created", {
          archivedAt: 1_000,
          deletedAt: 1_000,
          stopRequestedAt: 1_000,
        }),
      }),
    ).toEqual({ noop: "superseded", detail: "deletedAt set" });
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "start.succeeded" },
        thread: rowState("created", {
          archivedAt: 1_000,
          stopRequestedAt: 1_000,
        }),
      }),
    ).toEqual({ noop: "superseded", detail: "archivedAt set" });
  });
});
