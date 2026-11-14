import { describe, expect, it } from "vitest";
import type { ThreadTurnRequestState } from "@bb/db";
import {
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
  threadStatusValues,
  type ThreadStatusMove,
} from "@bb/domain";
import {
  nextThreadStatus,
  transitionThreadLifecycle,
  type ThreadLifecycleEffect,
  type ThreadLifecycleState,
} from "../../../src/services/threads/lifecycle/machine.js";

function state(overrides: Partial<ThreadLifecycleState>): ThreadLifecycleState {
  return {
    activeTurnId: null,
    archived: false,
    deleted: false,
    heldCompletion: null,
    provisioning: false,
    requests: [],
    status: "idle",
    stop: null,
    ...overrides,
  };
}

function request(
  overrides: Partial<ThreadTurnRequestState>,
): ThreadTurnRequestState {
  return {
    hostId: "host-1",
    kind: "steer",
    phase: "sent",
    requestId: "req-1",
    sentAt: 1,
    syncTitle: false,
    ...overrides,
  };
}

function kinds(effects: readonly ThreadLifecycleEffect[]): string[] {
  return effects.map((effect) => effect.kind);
}

function rejections(effects: readonly ThreadLifecycleEffect[]) {
  return effects.flatMap((effect) =>
    effect.kind === "append-request-rejected"
      ? [{ requestId: effect.requestId, reason: effect.reason }]
      : [],
  );
}

describe("server restart", () => {
  it("applies a completion that was held for a request whose answer died with the process", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "active",
        heldCompletion: { status: "completed", turnId: "turn-1" },
        requests: [request({ kind: "steer", phase: "sent" })],
      }),
      { type: "server.restarted" },
    );

    expect(transition.next.status).toBe("idle");
    expect(transition.next.heldCompletion).toBeNull();
    expect(transition.next.requests).toEqual([
      request({ kind: "steer", phase: "unconfirmed" }),
    ]);
    expect(rejections(transition.effects)).toEqual([]);
    expect(transition.effects).toContainEqual(
      expect.objectContaining({ kind: "turn-ended", disposition: "released" }),
    );
  });

  it("keeps a running turn's in-flight steer as unconfirmed until the turn ends", () => {
    const restarted = transitionThreadLifecycle(
      state({
        status: "active",
        activeTurnId: "turn-1",
        requests: [request({ kind: "steer", phase: "sent" })],
      }),
      { type: "server.restarted" },
    );
    expect(restarted.next.status).toBe("active");
    expect(restarted.next.requests).toEqual([
      request({ kind: "steer", phase: "unconfirmed" }),
    ]);

    const completed = transitionThreadLifecycle(
      state({
        status: "active",
        activeTurnId: "turn-1",
        requests: restarted.next.requests,
      }),
      { type: "turn.completed", turnId: "turn-1", status: "completed" },
    );
    expect(completed.next.status).toBe("idle");
    expect(completed.next.requests).toEqual([]);
    expect(rejections(completed.effects)).toEqual([
      { requestId: "req-1", reason: "steer_unconfirmed" },
    ]);
  });

  it("marks an in-flight stop unsent so the next daemon report sends it again", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "stopping",
        activeTurnId: "turn-1",
        stop: { ackedAt: null, reason: "manual-stop", requestedAt: 1, sentAt: 2 },
      }),
      { type: "server.restarted" },
    );
    expect(transition.next.stop?.sentAt).toBeNull();

    const reported = transitionThreadLifecycle(
      state({
        status: "stopping",
        activeTurnId: "turn-1",
        stop: transition.next.stop,
      }),
      {
        type: "daemon.reported",
        eventsPending: false,
        now: 3,
        revivalBlocked: false,
        running: true,
        sameInstance: true,
      },
    );
    expect(kinds(reported.effects)).toEqual(["send-stop"]);
    expect(reported.next.stop?.sentAt).toBe(3);
  });
});

describe("daemon reports after a reconnect", () => {
  const notRunning = {
    type: "daemon.reported" as const,
    eventsPending: false,
    now: 10,
    revivalBlocked: false,
    running: false,
    sameInstance: true,
  };

  it("settles an active thread from its held completion instead of failing it", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "active",
        heldCompletion: { status: "completed", turnId: "turn-1" },
        requests: [request({ kind: "new-turn", phase: "unconfirmed" })],
      }),
      notRunning,
    );
    expect(transition.next.status).toBe("idle");
    expect(kinds(transition.effects)).not.toContain("append-system-error");
    expect(rejections(transition.effects)).toEqual([
      { requestId: "req-1", reason: "turn_start_unconfirmed" },
    ]);
  });

  it("interrupts an active thread the daemon no longer runs", () => {
    const transition = transitionThreadLifecycle(
      state({ status: "active", activeTurnId: "turn-1" }),
      notRunning,
    );
    expect(transition.next.status).toBe("error");
    expect(kinds(transition.effects)).toEqual(
      expect.arrayContaining([
        "append-turn-interrupted",
        "append-system-error",
        "append-interruption",
        "notify-parent",
      ]),
    );
  });

  it("waits while the daemon still has events to deliver for the thread", () => {
    const transition = transitionThreadLifecycle(
      state({ status: "active", activeTurnId: "turn-1" }),
      { ...notRunning, eventsPending: true },
    );
    expect(transition.next.status).toBe("active");
    expect(transition.effects).toEqual([]);
  });

  it("fails a start whose answer was lost when the machine is not running it", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "starting",
        requests: [request({ kind: "thread-start", phase: "unconfirmed" })],
      }),
      notRunning,
    );
    expect(transition.next.status).toBe("error");
    expect(transition.next.requests).toEqual([]);
  });

  it("revives a start whose answer was lost when the machine runs it", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "starting",
        requests: [request({ kind: "thread-start", phase: "unconfirmed" })],
      }),
      { ...notRunning, running: true },
    );
    expect(transition.next.status).toBe("active");
    expect(transition.next.requests).toEqual([]);
  });
});

describe("stops", () => {
  it("keeps an unreachable stop owed and sends it when the socket opens", () => {
    const requested = transitionThreadLifecycle(
      state({ status: "active", activeTurnId: "turn-1" }),
      { type: "stop.requested", reason: "manual-stop", now: 1 },
    );
    expect(requested.next.status).toBe("stopping");
    expect(kinds(requested.effects)).toEqual(["append-interruption", "send-stop"]);

    const unreachable = transitionThreadLifecycle(
      state({
        status: "stopping",
        activeTurnId: "turn-1",
        stop: requested.next.stop,
      }),
      { type: "stop.answered", answer: { kind: "unreachable" }, now: 2 },
    );
    expect(unreachable.next.status).toBe("idle");
    expect(unreachable.next.stop).toMatchObject({ ackedAt: null, sentAt: null });

    const opened = transitionThreadLifecycle(
      state({ status: "idle", stop: unreachable.next.stop }),
      { type: "daemon.socket-opened", now: 3 },
    );
    expect(kinds(opened.effects)).toEqual(["send-stop"]);
  });

  it("drops an owed stop once a newer run is requested", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "idle",
        stop: { ackedAt: null, reason: "manual-stop", requestedAt: 1, sentAt: null },
      }),
      {
        type: "request.sent",
        request: {
          hostId: "host-1",
          kind: "new-turn",
          requestId: "req-2",
          syncTitle: false,
        },
        now: 5,
      },
    );
    expect(transition.next.status).toBe("active");
    expect(transition.next.stop).toBeNull();
  });

  it("re-stops instead of reviving when a turn starts after an acknowledged stop", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "idle",
        stop: { ackedAt: 2, reason: "manual-stop", requestedAt: 1, sentAt: null },
      }),
      { type: "turn.started", turnId: "turn-late", now: 3 },
    );
    expect(transition.next.status).toBe("idle");
    expect(kinds(transition.effects)).toEqual(["send-stop"]);
  });

  it("does not send a second stop while one is in flight", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "stopping",
        activeTurnId: "turn-1",
        stop: { ackedAt: null, reason: "manual-stop", requestedAt: 1, sentAt: 2 },
      }),
      { type: "stop.requested", reason: "manual-stop", now: 3 },
    );
    expect(kinds(transition.effects)).toEqual([]);
  });
});

describe("turn requests", () => {
  it("holds a completion while a steer awaits its answer and releases it when the answer arrives", () => {
    const held = transitionThreadLifecycle(
      state({
        status: "active",
        activeTurnId: "turn-1",
        requests: [request({ kind: "steer", phase: "sent" })],
      }),
      { type: "turn.completed", turnId: "turn-1", status: "completed" },
    );
    expect(held.next.status).toBe("active");
    expect(held.next.heldCompletion).toEqual({
      status: "completed",
      turnId: "turn-1",
    });

    const answered = transitionThreadLifecycle(
      state({
        status: "active",
        requests: held.next.requests,
        heldCompletion: held.next.heldCompletion,
      }),
      {
        type: "request.answered",
        requestId: "req-1",
        answer: { kind: "accepted", threadStart: null },
      },
    );
    expect(answered.next.status).toBe("idle");
    expect(answered.effects).toContainEqual(
      expect.objectContaining({ kind: "turn-ended", disposition: "released" }),
    );
  });

  it("drops a held completion when the answered request started a newer turn", () => {
    const answered = transitionThreadLifecycle(
      state({
        status: "active",
        activeTurnId: "turn-2",
        requests: [request({ kind: "steer", phase: "sent" })],
        heldCompletion: { status: "completed", turnId: "turn-1" },
      }),
      {
        type: "request.answered",
        requestId: "req-1",
        answer: { kind: "accepted", threadStart: null },
      },
    );
    expect(answered.next.status).toBe("active");
    expect(answered.next.heldCompletion).toBeNull();
  });

  it("does not let a thread start's own first turn completion wait for the start's answer", () => {
    const started = transitionThreadLifecycle(
      state({
        status: "starting",
        requests: [request({ kind: "thread-start", phase: "sent" })],
      }),
      { type: "turn.started", turnId: "turn-1", now: 2 },
    );
    expect(started.next.status).toBe("active");
    const completed = transitionThreadLifecycle(
      state({
        status: "active",
        activeTurnId: "turn-1",
        requests: started.next.requests,
      }),
      { type: "turn.completed", turnId: "turn-1", status: "completed" },
    );
    expect(completed.next.status).toBe("idle");
  });

  it("refuses a second thread start while one is in flight", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "starting",
        requests: [request({ kind: "thread-start", phase: "sent" })],
      }),
      {
        type: "request.sent",
        request: {
          hostId: "host-1",
          kind: "thread-start",
          requestId: "req-2",
          syncTitle: false,
        },
        now: 3,
      },
    );
    expect(transition.refusal).toBe("start-in-flight");
  });

  it("parks a steer whose answer was lost even when no turn is running", () => {
    const transition = transitionThreadLifecycle(
      state({
        status: "active",
        requests: [request({ kind: "steer", phase: "sent" })],
      }),
      {
        type: "request.answered",
        requestId: "req-1",
        answer: { kind: "lost" },
      },
    );
    expect(transition.next.status).toBe("active");
    expect(transition.next.requests).toEqual([
      request({ kind: "steer", phase: "unconfirmed" }),
    ]);
    expect(kinds(transition.effects)).toEqual([]);
  });
});

const STATUS_MOVES: readonly ThreadStatusMove[] = [
  "run.preparing",
  "run.started",
  "run.succeeded",
  "run.failed",
  "stop.requested",
  "stop.settled",
];

const CLEAN = { archived: false, deleted: false };

describe("nextThreadStatus", () => {
  it("applies every table cell on a clean row", () => {
    for (const status of threadStatusValues) {
      for (const move of STATUS_MOVES) {
        const to = THREAD_LIFECYCLE[status][move];
        if (to === undefined) continue;
        expect(nextThreadStatus({ ...CLEAN, status }, move)).toBe(to);
      }
    }
  });

  it("leaves the status for every absent cell on a clean row", () => {
    for (const status of threadStatusValues) {
      for (const move of STATUS_MOVES) {
        if (THREAD_LIFECYCLE[status][move] !== undefined) continue;
        expect(nextThreadStatus({ ...CLEAN, status }, move)).toBeNull();
      }
    }
  });

  it("supersedes or ignores each record flag exactly as declared", () => {
    for (const move of STATUS_MOVES) {
      const status = threadStatusValues.find(
        (candidate) => THREAD_LIFECYCLE[candidate][move] !== undefined,
      );
      if (status === undefined) throw new Error(`No cell for ${move}`);
      const predicates = THREAD_LIFECYCLE_EVENT_PREDICATES[move];
      expect(
        nextThreadStatus({ archived: false, deleted: true, status }, move),
      ).toBe(predicates.notDeleted ? null : THREAD_LIFECYCLE[status][move]);
      expect(
        nextThreadStatus({ archived: true, deleted: false, status }, move),
      ).toBe(predicates.notArchived ? null : THREAD_LIFECYCLE[status][move]);
    }
  });
});

describe("record flags in lifecycle inputs", () => {
  it("refuses to start a run on a deleted or archived thread and leaves the state as it was", () => {
    const send = {
      type: "request.sent" as const,
      request: {
        hostId: "host-1",
        kind: "new-turn" as const,
        requestId: "req-1",
        syncTitle: false,
      },
      now: 1,
    };
    const deleted = transitionThreadLifecycle(
      state({ status: "idle", deleted: true }),
      send,
    );
    expect(deleted.refusal).toBe("deleted");
    expect(deleted.next).toEqual({
      status: "idle",
      requests: [],
      heldCompletion: null,
      stop: null,
    });
    expect(
      transitionThreadLifecycle(state({ status: "idle", archived: true }), send)
        .refusal,
    ).toBe("archived");
  });

  it("still fails provisioning on an archived thread but not on a deleted one", () => {
    expect(
      transitionThreadLifecycle(state({ status: "starting", archived: true }), {
        type: "provisioning.failed",
      }).next.status,
    ).toBe("error");
    expect(
      transitionThreadLifecycle(state({ status: "starting", deleted: true }), {
        type: "provisioning.failed",
      }).refusal,
    ).toBe("not-settleable");
  });
});

function step(
  current: ThreadLifecycleState,
  input: Parameters<typeof transitionThreadLifecycle>[1],
  patch: Partial<ThreadLifecycleState> = {},
) {
  const transition = transitionThreadLifecycle(current, input);
  return { transition, next: { ...current, ...transition.next, ...patch } };
}

describe("stops that race other lifecycle inputs", () => {
  it("ignores a stop answer that arrives after a newer run started", () => {
    let current = state({ status: "active", activeTurnId: "T1" });
    ({ next: current } = step(current, {
      type: "stop.requested",
      reason: "manual-stop",
      now: 1,
    }));
    ({ next: current } = step(
      current,
      { type: "turn.completed", turnId: "T1", status: "interrupted" },
      { activeTurnId: null },
    ));
    ({ next: current } = step(current, {
      type: "request.sent",
      request: { hostId: "h", kind: "new-turn", requestId: "r2", syncTitle: false },
      now: 2,
    }));
    ({ next: current } = step(
      current,
      { type: "turn.started", turnId: "T2", now: 3 },
      { activeTurnId: "T2" },
    ));
    const late = step(current, {
      type: "stop.answered",
      answer: { kind: "stopped", providerCheckpointId: null },
      now: 4,
    });
    expect(late.next.status).toBe("active");
    expect(late.transition.effects).toEqual([]);
  });

  it.each([
    { label: "after a manual stop", overdue: false, status: "idle" },
    { label: "after a turn-start deadline stop", overdue: true, status: "error" },
  ] as const)(
    "keeps a second stop's finalized thread from reviving on a late turn start ($label)",
    ({ overdue, status }) => {
      let current = state({ status: "active", activeTurnId: null });
      ({ next: current } = step(
        current,
        overdue
          ? { type: "turn-start.overdue", deadlineMinutes: 5, now: 1 }
          : { type: "stop.requested", reason: "manual-stop", now: 1 },
      ));
      const second = step(current, {
        type: "stop.requested",
        reason: "manual-stop",
        now: 2,
      });
      expect(second.transition.stopRoute).toBe("pre-start");
      ({ next: current } = step(second.next, {
        type: "stop.finalized",
        fence: true,
        providerCheckpointId: null,
        now: 3,
      }));
      expect(current.status).toBe(status);
      const late = step(
        current,
        { type: "turn.started", turnId: "T1", now: 4 },
        { activeTurnId: "T1" },
      );
      expect(late.next.status).toBe(status);
      expect(kinds(late.transition.effects)).toEqual(["send-stop"]);
    },
  );

  it("keeps a deadline stop's reason through a daemon restart so the thread still ends in error", () => {
    let current = state({
      status: "active",
      requests: [request({ kind: "new-turn", phase: "unconfirmed" })],
    });
    ({ next: current } = step(current, {
      type: "turn-start.overdue",
      deadlineMinutes: 5,
      now: 1,
    }));
    ({ next: current } = step(current, {
      type: "daemon.lost",
      reason: "host-daemon-restarted",
      resuming: false,
    }));
    expect(current.stop?.reason).toBe("provider-turn-idle");
    const reported = step(current, {
      type: "daemon.reported",
      eventsPending: false,
      now: 2,
      revivalBlocked: false,
      running: false,
      sameInstance: false,
    });
    expect(reported.next.status).toBe("error");
  });

  it("fails a thread start whose daemon was lost before it answered", () => {
    const lost = step(
      state({
        status: "starting",
        requests: [request({ kind: "thread-start", phase: "sent" })],
      }),
      { type: "daemon.lost", reason: "host-removed", resuming: false },
    );
    expect(lost.next.status).toBe("error");
    expect(lost.next.requests).toEqual([]);
    expect(lost.transition.effects).toContainEqual(
      expect.objectContaining({
        kind: "append-system-error",
        message: "Thread start was interrupted",
      }),
    );
  });
});

describe("finalizations that are not stop requests", () => {
  it("lets the provider's next turn run after a plan cancel", () => {
    const cancelled = step(state({ status: "idle" }), {
      type: "stop.finalized",
      fence: false,
      providerCheckpointId: null,
      now: 1,
    });
    expect(cancelled.next.stop).toBeNull();
    const started = step(
      cancelled.next,
      { type: "turn.started", turnId: "T2", now: 2 },
      { activeTurnId: "T2" },
    );
    expect(started.next.status).toBe("active");
    expect(kinds(started.transition.effects)).not.toContain("send-stop");
  });
});

describe("lost daemons and thread starts", () => {
  it.each(["host-daemon-restarted", "host-removed"] as const)(
    "does not tell the parent about a deleted thread whose start the daemon lost (%s)",
    (reason) => {
      const lost = step(
        state({
          status: "starting",
          deleted: true,
          requests: [request({ kind: "thread-start", phase: "sent" })],
        }),
        { type: "daemon.lost", reason, resuming: false },
      );
      expect(kinds(lost.transition.effects)).not.toContain("notify-parent");
      expect(kinds(lost.transition.effects)).not.toContain(
        "append-system-error",
      );
      expect(lost.next.requests).toEqual([]);
    },
  );

  it("keeps a start whose connection was lost for the daemon's report to settle", () => {
    const lost = step(
      state({
        status: "starting",
        requests: [request({ kind: "thread-start", phase: "sent" })],
      }),
      { type: "daemon.lost", reason: "host-connection-lost", resuming: false },
    );
    expect(lost.next.status).toBe("starting");
    expect(lost.next.requests).toEqual([
      request({ kind: "thread-start", phase: "unconfirmed" }),
    ]);
    expect(lost.transition.effects).toEqual([]);
    const reported = step(lost.next, {
      type: "daemon.reported",
      eventsPending: false,
      now: 2,
      revivalBlocked: false,
      running: true,
      sameInstance: true,
    });
    expect(reported.next.status).toBe("active");
  });
});
