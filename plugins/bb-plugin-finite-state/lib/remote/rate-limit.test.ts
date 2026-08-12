import { describe, expect, it } from "vitest";
import { RemoteLimiter, type Scheduler } from "./rate-limit.js";
import { RemoteError } from "./types.js";

function retryable(retryAfterMs: number | null = null): RemoteError {
  return new RemoteError("retry", {
    service: "platform", code: "REMOTE_RATE_LIMITED", status: 429,
    retryable: true, retryAfterMs, details: null,
  });
}

describe("RemoteLimiter", () => {
  it("never exceeds configured concurrency and serves queued calls FIFO", async () => {
    const order: number[] = [];
    let active = 0;
    let maximum = 0;
    const limiter = new RemoteLimiter({
      concurrency: 8, maxAttempts: 6, maxBackoffMs: 64_000,
      scheduler: { now: Date.now, sleep: async () => undefined }, random: () => 0,
    });
    await Promise.all(Array.from({ length: 40 }, (_, index) => limiter.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      order.push(index);
      active -= 1;
      return index;
    })));
    expect(maximum).toBe(8);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("honors Retry-After, caps backoff, and exhausts after six attempts", async () => {
    const delays: number[] = [];
    const scheduler: Scheduler = {
      now: () => 0,
      sleep: async delay => { delays.push(delay); },
    };
    const limiter = new RemoteLimiter({ concurrency: 1, maxAttempts: 6, maxBackoffMs: 64_000, scheduler, random: () => 0 });
    let attempts = 0;
    await expect(limiter.run(async () => {
      attempts += 1;
      throw retryable(120_000);
    })).rejects.toMatchObject({ code: "REMOTE_RATE_LIMITED" });
    expect(attempts).toBe(6);
    expect(delays).toEqual([64_000, 64_000, 64_000, 64_000, 64_000]);
  });

  it("aborts queued work and in-flight retry sleep promptly", async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const limiter = new RemoteLimiter({
      concurrency: 1, maxAttempts: 6, maxBackoffMs: 64_000,
      scheduler: {
        now: () => 0,
        sleep: async (_delay, signal) => await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      },
      random: () => 0,
    });
    const first = limiter.run(async () => { await held; return 1; });
    const queuedAbort = new AbortController();
    const queued = limiter.run(async () => 2, queuedAbort.signal);
    queuedAbort.abort();
    await expect(queued).rejects.toMatchObject({ code: "REMOTE_ABORTED" });
    release();
    await first;
    const retrying = limiter.run(async () => { throw retryable(); });
    await Promise.resolve();
    limiter.close();
    await expect(retrying).rejects.toMatchObject({ code: "REMOTE_ABORTED" });
  });
});
