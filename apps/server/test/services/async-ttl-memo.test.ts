import { describe, expect, it, vi } from "vitest";
import { createAsyncTtlMemo } from "../../src/services/lib/async-ttl-memo.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("createAsyncTtlMemo", () => {
  it("starts TTL at completion and shares cold and refresh bursts", async () => {
    let now = 0;
    const cache = createAsyncTtlMemo<string, string>({
      ttlMs: 100,
      now: () => now,
    });
    const first = deferred<string>();
    const load = vi.fn(() => first.promise);
    const readers = Array.from({ length: 10 }, () => cache.run("key", load));
    now = 500;
    first.resolve("old");
    expect(await Promise.all(readers)).toEqual(Array(10).fill("old"));
    now = 599;
    expect(await cache.run("key", load)).toBe("old");
    expect(load).toHaveBeenCalledTimes(1);
    const next = deferred<string>();
    load.mockImplementation(() => next.promise);
    const refreshes = Array.from({ length: 10 }, () =>
      cache.run("key", load, true),
    );
    expect(load).toHaveBeenCalledTimes(2);
    next.resolve("new");
    expect(await Promise.all(refreshes)).toEqual(Array(10).fill("new"));
    now = 699;
    const expired = deferred<string>();
    load.mockImplementation(() => expired.promise);
    let completed = false;
    const waiting = cache.run("key", load).then((value) => {
      completed = true;
      return value;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
    expired.resolve("refreshed");
    expect(await waiting).toBe("refreshed");
  });

  it.each([
    { operation: "clear", staleFirst: true },
    { operation: "clear", staleFirst: false },
    { operation: "invalidateWhere", staleFirst: true },
    { operation: "invalidateWhere", staleFirst: false },
  ] as const)(
    "$operation detaches stale work when staleFirst is $staleFirst",
    async ({ operation, staleFirst }) => {
      const cache = createAsyncTtlMemo<string, string>({
        ttlMs: 100,
        now: () => 0,
      });
      const stale = deferred<string>();
      const fresh = deferred<string>();
      const before = cache.run("key", () => stale.promise);
      if (operation === "clear") cache.clear();
      else cache.invalidateWhere((key) => key === "key");
      const load = vi.fn(() => fresh.promise);
      const after = cache.run("key", load);
      if (staleFirst) {
        stale.resolve("stale");
        await before;
      }
      const concurrent = cache.run("key", load);
      expect(load).toHaveBeenCalledTimes(1);
      fresh.resolve("fresh");
      expect(await after).toBe("fresh");
      expect(await concurrent).toBe("fresh");
      if (!staleFirst) {
        stale.resolve("stale");
        await before;
      }
      expect(await cache.run("key", load)).toBe("fresh");
    },
  );

  it("retries rejected and synchronously throwing lookups", async () => {
    const cache = createAsyncTtlMemo<string, string>({ ttlMs: 100 });
    const failed = deferred<string>();
    const first = cache.run("key", () => failed.promise);
    const second = cache.run("key", () => Promise.resolve("wrong"));
    failed.reject(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    await expect(second).rejects.toThrow("offline");
    await expect(
      cache.run("key", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    expect(await cache.run("key", async () => "recovered")).toBe("recovered");
  });

  it("bounds retained results and allows shorter TTLs for absent results", async () => {
    let now = 0;
    const cache = createAsyncTtlMemo<string, string | null>({
      maxEntries: 2,
      now: () => now,
      ttlMs: (value) => (value === null ? 5 : 100),
    });
    await cache.run("one", async () => "one");
    await cache.run("two", async () => "two");
    await cache.run("absent", async () => null);
    const load = vi.fn(async () => "again");
    expect(await cache.run("two", load)).toBe("two");
    now = 5;
    expect(await cache.run("absent", load)).toBe("again");
    expect(await cache.run("one", load)).toBe("again");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keys entries independently and clears them on demand", async () => {
    const memo = createAsyncTtlMemo<string, string>({ ttlMs: 60_000 });
    await expect(memo.run("a", async () => "A")).resolves.toBe("A");
    await expect(memo.run("b", async () => "B")).resolves.toBe("B");
    await expect(memo.run("a", async () => "A2")).resolves.toBe("A");
    memo.clear();
    await expect(memo.run("a", async () => "A2")).resolves.toBe("A2");
  });
});
