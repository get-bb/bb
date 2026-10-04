import { describe, expect, it } from "vitest";
import {
  EMPTY_THREAD_NAVIGATION_HISTORY,
  recordThreadVisit,
  removeThreadNavigationEntries,
  stepThreadNavigationHistory,
  THREAD_NAVIGATION_HISTORY_LIMIT,
  type ThreadNavigationEntry,
  type ThreadNavigationHistory,
  type ThreadNavigationOffset,
} from "./thread-navigation-history";

function entry(threadId: string, projectId = "proj_1"): ThreadNavigationEntry {
  return { projectId, threadId };
}

function visitAll(threadIds: readonly string[]): ThreadNavigationHistory {
  return threadIds.reduce(
    (history, threadId) => recordThreadVisit(history, entry(threadId)),
    EMPTY_THREAD_NAVIGATION_HISTORY,
  );
}

function threadIds(history: ThreadNavigationHistory): string[] {
  return history.entries.map((item) => item.threadId);
}

function step(
  history: ThreadNavigationHistory,
  offset: ThreadNavigationOffset,
  {
    deleted = [],
    currentThreadId = history.entries[history.index]?.threadId,
  }: { deleted?: readonly string[]; currentThreadId?: string } = {},
) {
  return stepThreadNavigationHistory(history, offset, {
    currentThreadId,
    isAvailable: (item) => !deleted.includes(item.threadId),
  });
}

describe("thread navigation history", () => {
  it("pushes each visited thread and points at the latest", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);

    expect(threadIds(history)).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect(history.index).toBe(2);
  });

  it("does not push a repeat visit to the current thread", () => {
    const history = visitAll(["thr_a", "thr_b"]);

    expect(recordThreadVisit(history, entry("thr_b"))).toBe(history);
  });

  it("updates the current entry when its thread moves to another project", () => {
    const history = visitAll(["thr_a", "thr_b"]);

    const moved = recordThreadVisit(history, entry("thr_b", "proj_2"));

    expect(moved.entries).toEqual([entry("thr_a"), entry("thr_b", "proj_2")]);
    expect(moved.index).toBe(1);
  });

  it("steps back and forward without changing the entries", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);

    const back = step(history, -1);
    expect(back?.entry.threadId).toBe("thr_b");
    expect(back?.history.entries).toBe(history.entries);

    const backAgain = step(back!.history, -1);
    expect(backAgain?.entry.threadId).toBe("thr_a");
    expect(backAgain?.history.index).toBe(0);

    const forward = step(backAgain!.history, 1);
    expect(forward?.entry.threadId).toBe("thr_b");
  });

  it("does not push the thread reached by stepping", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);
    const back = step(history, -1)!.history;

    expect(recordThreadVisit(back, entry("thr_b"))).toBe(back);
    expect(step(back, 1)?.entry.threadId).toBe("thr_c");
  });

  it("does nothing at either end", () => {
    const history = visitAll(["thr_a", "thr_b"]);

    expect(step(history, 1)).toBeNull();
    const start = step(history, -1)!.history;
    expect(step(start, -1)).toBeNull();
    expect(step(EMPTY_THREAD_NAVIGATION_HISTORY, -1)).toBeNull();
    expect(step(EMPTY_THREAD_NAVIGATION_HISTORY, 1)).toBeNull();
  });

  it("drops forward entries when a different thread is opened after going back", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);
    const back = step(history, -1)!.history;

    const branched = recordThreadVisit(back, entry("thr_d"));

    expect(threadIds(branched)).toEqual(["thr_a", "thr_b", "thr_d"]);
    expect(branched.index).toBe(2);
    expect(step(branched, 1)).toBeNull();
  });

  it(`caps the history at ${THREAD_NAVIGATION_HISTORY_LIMIT} entries by dropping the oldest`, () => {
    const ids = Array.from(
      { length: THREAD_NAVIGATION_HISTORY_LIMIT + 5 },
      (_, index) => `thr_${index}`,
    );

    const history = visitAll(ids);

    expect(history.entries).toHaveLength(THREAD_NAVIGATION_HISTORY_LIMIT);
    expect(history.entries[0]?.threadId).toBe("thr_5");
    expect(history.index).toBe(THREAD_NAVIGATION_HISTORY_LIMIT - 1);
  });

  it("skips deleted threads in both directions", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c", "thr_d"]);

    const back = step(history, -1, { deleted: ["thr_c", "thr_b"] });
    expect(back?.entry.threadId).toBe("thr_a");
    expect(back?.history.index).toBe(0);

    const forward = step(back!.history, 1, { deleted: ["thr_b", "thr_c"] });
    expect(forward?.entry.threadId).toBe("thr_d");
  });

  it("does nothing when every earlier thread was deleted", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);

    expect(step(history, -1, { deleted: ["thr_a", "thr_b"] })).toBeNull();
  });

  it("goes back to the last thread from a page outside the history", () => {
    const history = visitAll(["thr_a", "thr_b"]);

    const back = stepThreadNavigationHistory(history, -1, {
      currentThreadId: undefined,
      isAvailable: () => true,
    });

    expect(back?.entry.threadId).toBe("thr_b");
    expect(
      stepThreadNavigationHistory(history, 1, {
        currentThreadId: undefined,
        isAvailable: () => true,
      }),
    ).toBeNull();
  });

  it("removes deleted threads and keeps the cursor on the surviving thread", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c", "thr_b", "thr_d"]);
    const back = step(history, -1)!.history;

    const pruned = removeThreadNavigationEntries(
      back,
      (item) => item.threadId === "thr_c",
    );

    expect(threadIds(pruned)).toEqual(["thr_a", "thr_b", "thr_d"]);
    expect(pruned.entries[pruned.index]?.threadId).toBe("thr_b");
  });

  it("removes every thread from a deleted project", () => {
    const history = [
      entry("thr_a"),
      entry("thr_b", "proj_2"),
      entry("thr_c"),
    ].reduce(recordThreadVisit, EMPTY_THREAD_NAVIGATION_HISTORY);

    const pruned = removeThreadNavigationEntries(
      history,
      (item) => item.projectId === "proj_1",
    );

    expect(pruned).toEqual({ entries: [entry("thr_b", "proj_2")], index: 0 });
    expect(
      removeThreadNavigationEntries(pruned, (item) => item.threadId === "none"),
    ).toBe(pruned);
  });
});
