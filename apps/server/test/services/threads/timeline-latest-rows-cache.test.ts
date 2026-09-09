import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { createTimelineLatestRowsCache } from "../../../src/services/threads/timeline-latest-rows-cache.js";

function rows(label: string): TimelineRow[] {
  return [
    {
      id: `row-${label}`,
      kind: "system",
      threadId: "thr_x",
      turnId: null,
      sourceSeqStart: 0,
      sourceSeqEnd: 0,
      startedAt: 0,
      createdAt: 0,
      systemKind: "debug",
      title: label,
      detail: null,
      status: null,
    },
  ];
}

describe("createTimelineLatestRowsCache", () => {
  it("keeps a ring of recent revisions per params key and evicts the oldest", () => {
    const cache = createTimelineLatestRowsCache({ ringSize: 3 });
    for (const maxSeq of [1, 2, 3]) {
      cache.set("thr_x", "k", { maxSeq, rows: rows(`r${maxSeq}`) });
    }
    expect(cache.get("thr_x", "k", 1)?.rows).toEqual(rows("r1"));
    expect(cache.get("thr_x", "k", 3)?.rows).toEqual(rows("r3"));

    cache.set("thr_x", "k", { maxSeq: 4, rows: rows("r4") });
    expect(cache.get("thr_x", "k", 1)).toBeUndefined();
    expect(cache.get("thr_x", "k", 2)?.rows).toEqual(rows("r2"));
    expect(cache.get("thr_x", "k", 4)?.rows).toEqual(rows("r4"));
    expect(cache.get("thr_x", "k", 5)).toBeUndefined();
    expect(cache.get("thr_x", "other", 4)).toBeUndefined();
  });

  it("a repeated set at the same revision refreshes recency without consuming a ring slot", () => {
    const cache = createTimelineLatestRowsCache({ ringSize: 2 });
    cache.set("thr_x", "k", { maxSeq: 1, rows: rows("r1") });
    cache.set("thr_x", "k", { maxSeq: 2, rows: rows("r2") });
    cache.set("thr_x", "k", { maxSeq: 1, rows: rows("r1") });
    cache.set("thr_x", "k", { maxSeq: 1, rows: rows("r1") });
    expect(cache.get("thr_x", "k", 1)?.rows).toEqual(rows("r1"));
    expect(cache.get("thr_x", "k", 2)?.rows).toEqual(rows("r2"));
    cache.set("thr_x", "k", { maxSeq: 3, rows: rows("r3") });
    expect(cache.get("thr_x", "k", 2)).toBeUndefined();
    expect(cache.get("thr_x", "k", 1)?.rows).toEqual(rows("r1"));
    expect(cache.get("thr_x", "k", 3)?.rows).toEqual(rows("r3"));
  });

  it("bounds params keys LRU-style; a lookup counts as use", () => {
    const cache = createTimelineLatestRowsCache({ maxEntries: 2 });
    cache.set("thr_a", "a", { maxSeq: 1, rows: rows("a") });
    cache.set("thr_b", "b", { maxSeq: 1, rows: rows("b") });
    expect(cache.get("thr_a", "a", 1)).toBeDefined();
    cache.set("thr_c", "c", { maxSeq: 1, rows: rows("c") });
    expect(cache.size).toBe(2);
    expect(cache.get("thr_b", "b", 1)).toBeUndefined();
    expect(cache.get("thr_a", "a", 1)?.rows).toEqual(rows("a"));
    expect(cache.get("thr_c", "c", 1)?.rows).toEqual(rows("c"));
  });

  it("invalidates only revisions for the rewritten thread", () => {
    const cache = createTimelineLatestRowsCache();
    cache.set("thr_x", "x", { maxSeq: 1, rows: rows("x") });
    cache.set("thr_y", "y", { maxSeq: 1, rows: rows("y") });

    cache.invalidateThread("thr_x");

    expect(cache.get("thr_x", "x", 1)).toBeUndefined();
    expect(cache.get("thr_y", "y", 1)?.rows).toEqual(rows("y"));
    expect(cache.size).toBe(1);
  });
});
