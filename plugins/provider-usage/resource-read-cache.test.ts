import { expect, it } from "vitest";
import { createResourceReadCache } from "./resource-read-cache.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

it("preserves a successful observation on failure, retries uncached failures, and clears recovered errors", async () => {
  let fail = true;
  const cache = createResourceReadCache(async () => {
    if (fail) throw new Error("offline");
    return 42;
  });
  const options = { force: false, maxAgeMs: 60_000 };
  expect((await cache.read("a", options)).error?.message).toBe("offline");
  fail = false;
  expect(await cache.read("a", options)).toEqual({ value: 42, error: null });
  fail = true;
  expect(await cache.read("a", { ...options, force: true })).toMatchObject({
    value: 42,
    error: new Error("offline"),
  });
  fail = false;
  cache.invalidate();
  expect(await cache.read("a", options)).toEqual({ value: 42, error: null });
  cache.dispose();
});

it("collects a forced observation after a pending cached read and shares concurrent forced reads", async () => {
  const first = deferred<number>();
  const second = deferred<number>();
  const attempts: boolean[] = [];
  const cache = createResourceReadCache(async (_key, force) => {
    attempts.push(force);
    return force ? second.promise : first.promise;
  });
  const ordinary = cache.read("a", { force: false, maxAgeMs: 0 });
  const forced = cache.read("a", { force: true, maxAgeMs: 0 });
  const queued = cache.read("a", { force: true, maxAgeMs: 0 });
  first.resolve(1);
  await ordinary;
  await Promise.resolve();
  const joined = cache.read("a", { force: true, maxAgeMs: 0 });
  second.resolve(2);
  expect(await forced).toEqual({ value: 2, error: null });
  expect(await queued).toEqual({ value: 2, error: null });
  expect(await joined).toEqual({ value: 2, error: null });
  expect(attempts).toEqual([false, true]);
  cache.dispose();
});

it("an evicted in-flight resource cannot populate its replacement", async () => {
  const old = deferred<number>();
  let calls = 0;
  const cache = createResourceReadCache(async () =>
    ++calls === 1 ? old.promise : 2,
  );
  const removed = cache.read("a", { force: false, maxAgeMs: 60_000 });
  await cache.read("other", { force: false, maxAgeMs: 60_000 });
  cache.retain(new Set(), (key) => key === "a");
  expect(cache.peek("other")?.value).toBe(2);
  expect(await cache.read("a", { force: false, maxAgeMs: 60_000 })).toEqual({
    value: 2,
    error: null,
  });
  old.resolve(1);
  await removed;
  expect(await cache.read("a", { force: false, maxAgeMs: 60_000 })).toEqual({
    value: 2,
    error: null,
  });
  cache.dispose();
});

it("re-reads an observation invalidated during collection", async () => {
  const pending = deferred<number>();
  let calls = 0;
  const cache = createResourceReadCache(async () =>
    ++calls === 1 ? pending.promise : 2,
  );
  const read = cache.read("a", { force: false, maxAgeMs: 60_000 });
  cache.invalidate();
  pending.resolve(1);
  expect(await read).toEqual({ value: 2, error: null });
  cache.dispose();
});

it("expires freshness without restarting a collection that is already pending", async () => {
  const pending = deferred<number>();
  let calls = 0;
  const cache = createResourceReadCache(async () =>
    ++calls === 1 ? pending.promise : 2,
  );
  const options = { force: false, maxAgeMs: 60_000 };
  const read = cache.read("a", options);
  cache.expire();
  pending.resolve(1);
  expect(await read).toEqual({ value: 1, error: null });
  expect(calls).toBe(1);
  cache.expire();
  expect(await cache.read("a", options)).toEqual({ value: 2, error: null });
  cache.dispose();
});
