import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { turnScope } from "@bb/domain";
import { RuntimeSessionStates } from "./runtime-session-state.js";

function turnStarted(
  turnId: string,
  options: { parentToolCallId?: string } = {},
): ThreadEvent {
  return {
    type: "turn/started",
    threadId: "t1",
    providerThreadId: "p1",
    ...(options.parentToolCallId
      ? { parentToolCallId: options.parentToolCallId }
      : {}),
    scope: turnScope(turnId),
  };
}

function turnCompleted(turnId: string): ThreadEvent {
  return {
    type: "turn/completed",
    threadId: "t1",
    providerThreadId: "p1",
    scope: turnScope(turnId),
    status: "completed",
  };
}

function compaction(
  type: "item/started" | "item/completed",
  turnId: string,
): ThreadEvent {
  return {
    type,
    threadId: "t1",
    providerThreadId: "p1",
    scope: turnScope(turnId),
    item: { type: "contextCompaction", id: "compact-1" },
  };
}

function liveSession(): RuntimeSessionStates {
  const sessions = new RuntimeSessionStates();
  sessions.beginConstruction("t1");
  sessions.markLive("t1");
  return sessions;
}

describe("RuntimeSessionStates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("admits a turn only from idle and moves through the explicit phases", () => {
    const sessions = new RuntimeSessionStates();
    expect(sessions.admitTurnStart("t1")).toMatchObject({ kind: "busy" });
    sessions.beginConstruction("t1");
    expect(sessions.phase("t1").phase).toBe("starting");
    expect(sessions.admitTurnStart("t1")).toMatchObject({ kind: "busy" });
    sessions.markLive("t1");

    expect(sessions.admitTurnStart("t1")).toEqual({ kind: "admitted" });
    expect(sessions.phase("t1").phase).toBe("turnStarting");
    expect(sessions.admitTurnStart("t1")).toMatchObject({ kind: "busy" });

    sessions.observe(turnStarted("turn-1"));
    expect(sessions.phase("t1")).toEqual({
      phase: "turnRunning",
      turnId: "turn-1",
    });

    sessions.observe(turnCompleted("turn-1"));
    expect(sessions.phase("t1").phase).toBe("idle");
  });

  it("is compacting while a compaction item is open and answers steers busy", () => {
    const sessions = liveSession();
    sessions.observe(turnStarted("turn-1"));
    sessions.observe(compaction("item/started", "turn-1"));

    expect(sessions.phase("t1").phase).toBe("compacting");
    expect(sessions.admitSteer("t1", "turn-1")).toMatchObject({
      kind: "busy",
    });

    sessions.observe(compaction("item/completed", "turn-1"));
    expect(sessions.admitSteer("t1", "turn-1")).toEqual({ kind: "admitted" });
  });

  it("waits on the user while an interaction is open", () => {
    const sessions = liveSession();
    sessions.observe(turnStarted("turn-1"));
    sessions.beginInteraction("t1");
    expect(sessions.phase("t1")).toEqual({
      phase: "waitingOnUser",
      turnId: "turn-1",
    });
    sessions.endInteraction("t1");
    expect(sessions.phase("t1").phase).toBe("turnRunning");
  });

  it("reports a steer for another turn as stale", () => {
    const sessions = liveSession();
    sessions.observe(turnStarted("turn-1"));
    expect(sessions.admitSteer("t1", "turn-0")).toEqual({
      kind: "stale",
      activeTurnId: "turn-1",
    });
  });

  it("keeps the root turn active when a delegated child completes", () => {
    const sessions = liveSession();
    sessions.observe(turnStarted("root-turn"));
    sessions.observe(turnStarted("child-turn", { parentToolCallId: "tool-1" }));
    sessions.observe(turnCompleted("child-turn"));

    expect(sessions.getActiveTurnId("t1")).toBe("root-turn");
  });

  it("returns to the previous phase when a stop fails", () => {
    const sessions = liveSession();
    sessions.markStopping("t1");
    expect(sessions.admitTurnStart("t1")).toMatchObject({ kind: "busy" });
    sessions.cancelStopping("t1");
    expect(sessions.phase("t1").phase).toBe("idle");
  });

  it("fires the turn-start watchdog once per overdue start", () => {
    vi.useFakeTimers();
    const sessions = liveSession();
    sessions.admitTurnStart("t1");
    vi.advanceTimersByTime(1_000);

    expect(sessions.takeOverdueTurnStarts(500)).toEqual([
      { threadId: "t1", sinceMs: expect.any(Number) },
    ]);
    expect(sessions.takeOverdueTurnStarts(500)).toEqual([]);
  });

  it("resolves an active-turn waiter when the turn opens", async () => {
    const sessions = liveSession();
    sessions.admitTurnStart("t1");
    const waiter = sessions.waitForActiveTurn({
      threadId: "t1",
      timeoutMs: 1_000,
    });
    sessions.observe(turnStarted("turn-1"));
    await expect(waiter).resolves.toBe("turn-1");
  });
});
