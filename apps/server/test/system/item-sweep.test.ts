import { describe, expect, it, vi } from "vitest";
import { listSweepItemFailures } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { defineItemSweep } from "../../src/services/system/item-sweep.js";
import { testLogger } from "../helpers/test-app.js";

const NOW = 1_000_000;

function setup() {
  return { db: createMigratedConnection(), logger: testLogger };
}

function failuresOf(deps: ReturnType<typeof setup>, sweep: string) {
  return listSweepItemFailures(deps.db, sweep);
}

describe("item sweeps", () => {
  it("keeps going past a failing item, backs it off, and clears the record once it succeeds", async () => {
    const deps = setup();
    const processed: string[] = [];
    const listed: Array<ReadonlySet<string>> = [];
    let failing = true;
    const sweep = defineItemSweep({
      name: "test-isolation",
      concurrency: 1,
      list: ({ excludedKeys }) => {
        listed.push(new Set(excludedKeys));
        return ["a", "b", "c"];
      },
      key: (item) => item,
      process: (item) => {
        if (item === "a" && failing) throw new Error("item a is broken");
        processed.push(item);
      },
    });

    await sweep.run(deps, NOW);
    expect(processed).toEqual(["b", "c"]);
    expect(failuresOf(deps, "test-isolation")).toEqual([
      {
        attempts: 1,
        firstFailedAt: NOW,
        itemKey: "a",
        lastError: "item a is broken",
        retryAt: NOW + 60_000,
        sweep: "test-isolation",
      },
    ]);

    await sweep.run(deps, NOW + 59_999);
    expect(listed.at(-1)).toEqual(new Set(["a"]));
    expect(processed).toEqual(["b", "c", "b", "c"]);

    failing = false;
    await sweep.run(deps, NOW + 60_000);
    expect(processed.slice(4)).toEqual(["a", "b", "c"]);
    expect(failuresOf(deps, "test-isolation")).toEqual([]);
  });

  it("doubles the delay on each failure, needs recovery after the eighth, then retries hourly until a success clears it", async () => {
    const deps = setup();
    const error = vi.spyOn(deps.logger, "error");
    let failing = true;
    let calls = 0;
    const sweep = defineItemSweep({
      name: "test-escalation",
      concurrency: 1,
      list: () => ["a"],
      key: (item) => item,
      process: () => {
        calls += 1;
        if (failing) throw new Error("still broken");
      },
    });
    const delays: number[] = [];
    let now = NOW;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await sweep.run(deps, now);
      const retryAt = failuresOf(deps, "test-escalation")[0]?.retryAt;
      if (retryAt === undefined) throw new Error("missing retry");
      delays.push(retryAt - now);
      now = retryAt;
    }
    expect(delays).toEqual(
      [1, 2, 4, 8, 16, 32, 60, 60, 60, 60].map((minutes) => minutes * 60_000),
    );
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ attempts: 8, itemKey: "a" }),
      "Sweep item needs recovery; retrying hourly until it succeeds or bb server sweeps retry",
    );
    await sweep.run(deps, now - 1);
    expect(calls).toBe(10);

    failing = false;
    await sweep.run(deps, now);
    expect(calls).toBe(11);
    expect(failuresOf(deps, "test-escalation")).toEqual([]);
    error.mockRestore();
  });

  it("forgets a failure an hour after its item stopped being listed", async () => {
    const deps = setup();
    let items = ["a"];
    const sweep = defineItemSweep({
      name: "test-forget",
      concurrency: 1,
      list: () => items,
      key: (item) => item,
      process: () => {
        throw new Error("broken");
      },
    });
    await sweep.run(deps, NOW);
    items = [];
    await sweep.run(deps, NOW + 1);
    expect(failuresOf(deps, "test-forget")).toHaveLength(1);
    await sweep.run(deps, NOW + 60_000 + 3_599_999);
    expect(failuresOf(deps, "test-forget")).toHaveLength(1);
    await sweep.run(deps, NOW + 60_000 + 3_600_000);
    expect(failuresOf(deps, "test-forget")).toEqual([]);
  });

  it("does not start an item that an overlapping pass of the same sweep is already running", async () => {
    const deps = setup();
    const started: string[] = [];
    const finish = new Map<string, Array<() => void>>();
    const sweep = defineItemSweep({
      name: "test-overlap",
      concurrency: 1,
      list: () => ["a", "b"],
      key: (item) => item,
      process: (item) => {
        started.push(item);
        return new Promise<void>((resolve) => {
          finish.set(item, [...(finish.get(item) ?? []), resolve]);
        });
      },
    });

    let firstDone = false;
    const first = sweep.run(deps, NOW).then(() => {
      firstDone = true;
    });
    await vi.waitFor(() => expect(started).toEqual(["a"]));
    const second = sweep.run(deps, NOW);
    await vi.waitFor(() => expect(started).toEqual(["a", "b"]));
    for (const resolve of finish.get("a") ?? []) resolve();
    await vi.waitFor(() => expect(firstDone || started.length > 2).toBe(true));
    const startedWhileOverlapping = [...started];
    for (const resolves of finish.values())
      for (const resolve of resolves) resolve();
    await Promise.all([first, second]);

    expect(startedWhileOverlapping).toEqual(["a", "b"]);
  });

  it("stops waiting for items that run longer than a minute, skips them while they run, and records their later failure", async ({
    signal,
    onTestFinished,
  }) => {
    const deps = setup();
    const finishHung = new Map<string, () => void>();
    let first: Promise<void> | undefined;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () =>
      (cleanupPromise ??= (async () => {
        for (const finish of finishHung.values()) finish();
        try {
          await first;
        } finally {
          deps.db.$client.close();
          vi.useRealTimers();
        }
      })());
    onTestFinished(cleanup);
    try {
      const rejectHung = new Map<string, (error: Error) => void>();
      const processed: string[] = [];
      const admitted = new Set<string>();
      let allItemsStarted!: () => void;
      const itemsStarted = new Promise<void>((resolve) => {
        allItemsStarted = resolve;
      });
      const listed: Array<ReadonlySet<string>> = [];
      const sweep = defineItemSweep({
        name: "test-detach",
        concurrency: Number.POSITIVE_INFINITY,
        list: ({ excludedKeys }) => {
          listed.push(new Set(excludedKeys));
          return ["hung-1", "hung-2", "quick"];
        },
        key: (item) => item,
        process: (item) => {
          admitted.add(item);
          if (admitted.size === 3) allItemsStarted();
          if (item === "quick") {
            processed.push(item);
            return;
          }
          return new Promise<void>((resolve, reject) => {
            finishHung.set(item, resolve);
            rejectHung.set(item, reject);
          });
        },
      });

      let finished = false;
      first = sweep.run(deps, NOW).then(() => {
        finished = true;
      });
      await itemsStarted;
      signal.throwIfAborted();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(processed).toEqual(["quick"]);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await first;
      signal.throwIfAborted();

      await sweep.run(deps, NOW + 1);
      expect(listed.at(-1)).toEqual(new Set(["hung-1", "hung-2"]));
      expect(processed).toEqual(["quick", "quick"]);

      await vi.advanceTimersByTimeAsync(600_000);
      rejectHung.get("hung-1")?.(new Error("hung item gave up"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(failuresOf(deps, "test-detach")).toMatchObject([
        {
          attempts: 1,
          firstFailedAt: NOW + 660_000,
          itemKey: "hung-1",
          lastError: "hung item gave up",
          retryAt: NOW + 720_000,
        },
      ]);
    } finally {
      await cleanup();
    }
  });
});
