import { describe, expect, it } from "vitest";
import { Semaphore } from "../src/semaphore.js";

/** Flush pending microtasks (and resolved-waiter continuations) before asserting. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Semaphore", () => {
  it("rejects non-positive or fractional limits", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow(RangeError);
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
  });

  it("admits queued waiters strictly in arrival order", async () => {
    const sem = new Semaphore(1);
    const releaseHolder = await sem.acquire();
    const admitted: number[] = [];
    const waiters = [0, 1, 2, 3, 4].map((n) =>
      sem.acquire().then((release) => {
        admitted.push(n);
        return release;
      }),
    );
    await macrotask();
    expect(admitted).toEqual([]);

    releaseHolder();
    for (const [n, waiter] of waiters.entries()) {
      const release = await waiter;
      // Exactly the first n+1 waiters have been admitted, in FIFO order.
      expect(admitted).toEqual([0, 1, 2, 3, 4].slice(0, n + 1));
      release();
    }
  });

  it("releases its slot when the wrapped function throws", async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    const failing = sem.run(async () => {
      order.push("failing:start");
      await macrotask();
      throw new Error("boom");
    });
    // Queued behind the failing holder; only the throw's release can admit it.
    const succeeding = sem.run(async () => {
      order.push("succeeding:start");
      return "done";
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(succeeding).resolves.toBe("done");
    expect(order).toEqual(["failing:start", "succeeding:start"]);
  });

  it("ignores a second release of the same slot", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const admitted: number[] = [];
    const waiters = [0, 1].map((n) =>
      sem.acquire().then((r) => {
        admitted.push(n);
        return r;
      }),
    );
    release();
    // The duplicate call must not hand a second slot to the next waiter.
    release();
    await macrotask();
    expect(admitted).toEqual([0]);

    (await waiters[0])();
    await macrotask();
    expect(admitted).toEqual([0, 1]);
  });

  it("never exceeds the cap under interleaved load and completes every task", async () => {
    const limit = 3;
    const sem = new Semaphore(limit);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 40 }, (_, i) =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        expect(active).toBeLessThanOrEqual(limit);
        // Vary suspension depth so releases interleave with fresh acquires —
        // this exercises the direct slot-handoff path against the fast path.
        for (let tick = 0; tick <= i % 5; tick++) {
          await Promise.resolve();
        }
        active--;
        return i;
      }),
    );
    const results = await Promise.all(tasks);
    expect(peak).toBe(limit);
    expect(active).toBe(0);
    expect(results).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });
});
