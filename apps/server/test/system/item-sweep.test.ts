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

  it("doubles the delay on each failure and logs an error from the fifth", async () => {
    const deps = setup();
    const error = vi.spyOn(deps.logger, "error");
    const sweep = defineItemSweep({
      name: "test-escalation",
      concurrency: 1,
      list: () => ["a"],
      key: (item) => item,
      process: () => {
        throw new Error("still broken");
      },
    });
    const delays: number[] = [];
    let now = NOW;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await sweep.run(deps, now);
      const failure = failuresOf(deps, "test-escalation")[0];
      if (failure === undefined) throw new Error("missing failure record");
      delays.push(failure.retryAt - now);
      now = failure.retryAt;
    }
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ attempts: 5, itemKey: "a" }),
      "Sweep item keeps failing; other items continue",
    );
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

  it("stops waiting for items that run longer than a minute, skips them while they run, and records their later failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const deps = setup();
      const rejectHung = new Map<string, (error: Error) => void>();
      const processed: string[] = [];
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
          if (item === "quick") {
            processed.push(item);
            return;
          }
          return new Promise<void>((_resolve, reject) => {
            rejectHung.set(item, reject);
          });
        },
      });

      let finished = false;
      const first = sweep.run(deps, NOW).then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(59_999);
      expect(processed).toEqual(["quick"]);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await first;

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
      vi.useRealTimers();
    }
  });
});
