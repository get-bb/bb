import { describe, expect, it } from "vitest";
import type { ThreadTurnRequestState } from "@bb/db";
import {
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
