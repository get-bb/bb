import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  buildTimelineTurnProcessTimings,
  findTimelineTurnProcessTiming,
} from "./timeline-turn-process";

describe("buildTimelineTurnProcessTimings", () => {
  it("indexes turn rows by turn id with their process window", () => {
    const timings = buildTimelineTurnProcessTimings([
      turnRow({
        id: "turn-row",
        seq: 1,
        turnId: "turn-1",
        startedAt: 1_000,
        durationMs: 5_000,
        status: "completed",
      }),
    ]);

    expect(findTimelineTurnProcessTiming(timings, "turn-1")).toEqual({
      completedAt: 6_000,
      live: false,
      startedAt: 1_000,
    });
  });

  it("marks a pending turn as live", () => {
    const timings = buildTimelineTurnProcessTimings([
      turnRow({
        id: "turn-row",
        seq: 1,
        turnId: "turn-1",
        startedAt: 1_000,
        status: "pending",
        durationMs: null,
      }),
    ]);

    expect(findTimelineTurnProcessTiming(timings, "turn-1")).toEqual({
      completedAt: null,
      live: true,
      startedAt: 1_000,
    });
  });

  it("ignores conversation and work rows", () => {
    const rows: TimelineRow[] = [
      conversationRow({
        id: "message",
        role: "assistant",
        text: "ANSWER",
        threadId: "thr_main",
        turnId: "turn-1",
        sourceSeqStart: 2,
        sourceSeqEnd: 2,
        createdAt: 2,
        startedAt: 2,
      }),
      commandRow({
        command: "npm test",
        id: "command",
        threadId: "thr_main",
        turnId: "turn-1",
        sourceSeqStart: 3,
        sourceSeqEnd: 3,
      }),
    ];

    expect(buildTimelineTurnProcessTimings(rows).size).toBe(0);
  });

  it("returns null for missing turn ids", () => {
    const timings = buildTimelineTurnProcessTimings([]);

    expect(findTimelineTurnProcessTiming(timings, "turn-1")).toBeNull();
    expect(findTimelineTurnProcessTiming(timings, null)).toBeNull();
  });
});
