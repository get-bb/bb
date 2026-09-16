import { describe, expect, it } from "vitest";
import {
  EMPTY_THREAD_NAVIGATION_HISTORY,
  isThreadNavigationHistory,
  recordThreadVisit,
  stepThreadNavigationHistory,
  THREAD_NAVIGATION_HISTORY_LIMIT,
  type ThreadNavigationHistory,
} from "./thread-navigation-history";

function entry(threadId: string, projectId = "proj_1") {
  return { projectId, threadId };
}

function visitAll(threadIds: readonly string[]): ThreadNavigationHistory {
  return threadIds.reduce(
    (history, threadId) => recordThreadVisit(history, entry(threadId)),
    EMPTY_THREAD_NAVIGATION_HISTORY,
  );
}

describe("thread navigation history", () => {
  it("appends visits in the order threads were opened", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);

    expect(history.entries.map((item) => item.threadId)).toEqual([
      "thr_a",
      "thr_b",
      "thr_c",
    ]);
    expect(history.index).toBe(2);
  });

  it("ignores a repeat visit to the thread already at the cursor", () => {
    const history = visitAll(["thr_a", "thr_b"]);

    expect(recordThreadVisit(history, entry("thr_b"))).toBe(history);
  });

  it("steps back and forward without changing the entries", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);

    const back = stepThreadNavigationHistory(history, -1);
    expect(back?.entry.threadId).toBe("thr_b");
    expect(back?.history.index).toBe(1);
    expect(back?.history.entries).toBe(history.entries);

    const backAgain = stepThreadNavigationHistory(back!.history, -1);
    expect(backAgain?.entry.threadId).toBe("thr_a");

    const forward = stepThreadNavigationHistory(backAgain!.history, 1);
    expect(forward?.entry.threadId).toBe("thr_b");
  });

  it("refuses to step past either end", () => {
    const history = visitAll(["thr_a", "thr_b"]);

    expect(stepThreadNavigationHistory(history, 1)).toBeNull();
    const start = stepThreadNavigationHistory(history, -1)!.history;
    expect(stepThreadNavigationHistory(start, -1)).toBeNull();
    expect(
      stepThreadNavigationHistory(EMPTY_THREAD_NAVIGATION_HISTORY, -1),
    ).toBeNull();
  });

  it("drops forward entries when a new thread is opened after going back", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);
    const back = stepThreadNavigationHistory(history, -1)!.history;

    const branched = recordThreadVisit(back, entry("thr_d"));

    expect(branched.entries.map((item) => item.threadId)).toEqual([
      "thr_a",
      "thr_b",
      "thr_d",
    ]);
    expect(branched.index).toBe(2);
    expect(stepThreadNavigationHistory(branched, 1)).toBeNull();
  });

  it("keeps the cursor in place when returning to the thread it points at", () => {
    const history = visitAll(["thr_a", "thr_b"]);
    const back = stepThreadNavigationHistory(history, -1)!.history;

    expect(recordThreadVisit(back, entry("thr_a"))).toBe(back);
    expect(stepThreadNavigationHistory(back, 1)?.entry.threadId).toBe("thr_b");
  });

  it("caps the history at the limit by dropping the oldest entries", () => {
    const threadIds = Array.from(
      { length: THREAD_NAVIGATION_HISTORY_LIMIT + 5 },
      (_, index) => `thr_${index}`,
    );

    const history = visitAll(threadIds);

    expect(history.entries).toHaveLength(THREAD_NAVIGATION_HISTORY_LIMIT);
    expect(history.entries[0]?.threadId).toBe("thr_5");
    expect(history.index).toBe(THREAD_NAVIGATION_HISTORY_LIMIT - 1);
  });

  it("validates persisted history shapes", () => {
    expect(isThreadNavigationHistory(visitAll(["thr_a"]))).toBe(true);
    expect(isThreadNavigationHistory(EMPTY_THREAD_NAVIGATION_HISTORY)).toBe(
      true,
    );
    expect(
      isThreadNavigationHistory({ entries: [entry("thr_a")], index: 1 }),
    ).toBe(false);
    expect(isThreadNavigationHistory({ entries: [], index: 0 })).toBe(false);
    expect(
      isThreadNavigationHistory({
        entries: [{ threadId: "thr_a" }],
        index: 0,
      }),
    ).toBe(false);
    expect(isThreadNavigationHistory(null)).toBe(false);
  });
});
