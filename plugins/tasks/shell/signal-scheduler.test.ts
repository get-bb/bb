import { describe, expect, it } from "vitest";
import {
  createTaskSignalScheduler,
  type TaskSignal,
} from "./signal-scheduler.js";

const TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";
const OTHER_TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT2";

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(
  options: {
    relevantTaskIds?: readonly string[];
    canPatch?: boolean;
  } = {},
) {
  let timer: (() => void) | null = null;
  let hidden = false;
  const counts = { refetch: 0, refetchAfterFetch: 0 };
  const patched: TaskSignal[][] = [];
  const scheduler = createTaskSignalScheduler({
    channels: () => ["tasks:changed"],
    relevantTaskIds: () => options.relevantTaskIds,
    isHidden: () => hidden,
    setTimer: (callback) => {
      timer = callback;
      return () => {
        timer = null;
      };
    },
    refetch: () => {
      counts.refetch += 1;
    },
    refetchAfterFetch: () => {
      counts.refetchAfterFetch += 1;
    },
    preparePatch: (signals) =>
      options.canPatch === true
        ? async () => {
            patched.push(signals);
          }
        : null,
  });
  const fireTimer = () => timer?.();
  const setHidden = (value: boolean) => {
    hidden = value;
  };
  return { scheduler, counts, patched, fireTimer, setHidden };
}

describe("task signal scheduler", () => {
  it("patches one batch per burst of signals for the same task", async () => {
    const { scheduler, counts, patched, fireTimer } = setup({
      canPatch: true,
    });

    for (let index = 0; index < 5; index += 1) {
      scheduler.push("tasks:changed", { taskId: TASK_ID });
    }
    fireTimer();
    await settle();

    expect(patched).toEqual([[{ channel: "tasks:changed", taskId: TASK_ID }]]);
    expect(counts.refetch).toBe(0);
  });

  it("falls back to a full refetch when a signal names no task", async () => {
    const { scheduler, counts, patched, fireTimer } = setup({
      canPatch: true,
    });

    scheduler.push("tasks:changed", { projectId: "project-wide" });
    fireTimer();
    await settle();

    expect(counts.refetch).toBe(1);
    expect(patched).toEqual([]);
  });

  it("ignores signals about tasks the query does not depend on", () => {
    const { scheduler, counts, fireTimer } = setup({
      relevantTaskIds: [TASK_ID],
    });

    for (let index = 0; index < 3; index += 1) {
      scheduler.push("tasks:changed", { taskId: OTHER_TASK_ID });
    }
    fireTimer();
    expect(counts.refetch).toBe(0);

    scheduler.push("tasks:changed", { taskId: TASK_ID });
    fireTimer();
    expect(counts.refetch).toBe(1);
    scheduler.push("tasks:changed", { projectId: "project-wide" });
    fireTimer();
    expect(counts.refetch).toBe(2);
  });

  it("queues one follow-up instead of stacking refetches on a fetch that is still running", async () => {
    const { scheduler, counts, fireTimer } = setup();
    const fetch = deferred();
    const tracked = scheduler.trackFetch(() => fetch.promise);

    for (let index = 0; index < 3; index += 1) {
      scheduler.push("tasks:changed", { taskId: TASK_ID });
      fireTimer();
    }
    expect(counts.refetch).toBe(0);
    expect(counts.refetchAfterFetch).toBe(0);

    fetch.resolve();
    await tracked;
    expect(counts.refetchAfterFetch).toBe(1);

    await scheduler.trackFetch(() => Promise.resolve());
    expect(counts.refetchAfterFetch).toBe(1);
    expect(counts.refetch).toBe(0);
  });

  it("patches after a running fetch instead of refetching everything", async () => {
    const { scheduler, counts, patched, fireTimer } = setup({
      canPatch: true,
    });
    const fetch = deferred();
    const tracked = scheduler.trackFetch(() => fetch.promise);

    scheduler.push("tasks:changed", { taskId: TASK_ID });
    fireTimer();
    await settle();
    expect(patched).toEqual([]);

    fetch.resolve();
    await tracked;
    await settle();
    expect(patched).toEqual([[{ channel: "tasks:changed", taskId: TASK_ID }]]);
    expect(counts.refetch).toBe(0);
    expect(counts.refetchAfterFetch).toBe(0);
  });

  it("holds signals while the page is hidden and handles them once when it is visible again", () => {
    const { scheduler, counts, fireTimer, setHidden } = setup();

    setHidden(true);
    for (let index = 0; index < 4; index += 1) {
      scheduler.push("tasks:changed", { taskId: TASK_ID });
      fireTimer();
    }
    expect(counts.refetch).toBe(0);

    setHidden(false);
    scheduler.flush();
    fireTimer();
    expect(counts.refetch).toBe(1);
  });
});
