import { describe, expect, it } from "vitest";
import {
  applyTimelineDelta,
  computeTimelineRowDelta,
  type TimelineRow,
} from "../src/thread-timeline.js";

function row(id: string, sourceSeqStart: number, title = "t"): TimelineRow {
  return {
    id,
    kind: "system",
    threadId: "thr_x",
    turnId: null,
    sourceSeqStart,
    sourceSeqEnd: sourceSeqStart,
    startedAt: 0,
    createdAt: 0,
    systemKind: "debug",
    title,
    detail: null,
    status: null,
  };
}

describe("timeline delta", () => {
  it("round-trips an upsert + insert (compute then apply equals current)", () => {
    const prev = [row("a", 1), row("b", 2)];
    const current = [row("a", 1), row("b", 2, "changed"), row("c", 3)];
    const delta = computeTimelineRowDelta(prev, current);
    expect(delta.upsertRows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(applyTimelineDelta(prev, delta)).toEqual(current);
  });

  it("round-trips a removal (collapse/eviction)", () => {
    const prev = [row("a", 1), row("b", 2), row("c", 3)];
    const current = [row("a", 1), row("c", 3)];
    const delta = computeTimelineRowDelta(prev, current);
    expect(delta.upsertRows).toHaveLength(0);
    expect(applyTimelineDelta(prev, delta)).toEqual(current);
  });

  it("preserves unchanged row identity (no needless re-render)", () => {
    const a = row("a", 1);
    const prev = [a, row("b", 2)];
    const current = [a, row("b", 2, "changed")];
    const merged = applyTimelineDelta(
      prev,
      computeTimelineRowDelta(prev, current),
    );
    expect(merged?.[0]).toBe(a);
  });

  it("returns null when the base is stale (id neither held nor sent)", () => {
    expect(
      applyTimelineDelta([row("a", 1)], {
        upsertRows: [],
        rowOrder: ["a", "z"],
      }),
    ).toBeNull();
  });
});
