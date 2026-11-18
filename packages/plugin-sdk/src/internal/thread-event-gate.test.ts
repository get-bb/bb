import { describe, expect, it } from "vitest";
import { createThreadEventGate } from "./thread-event-gate.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function harness() {
  let clock = 100;
  const scheduled: Array<() => void> = [];
  const delivered: string[] = [];
  const gate = createThreadEventGate({
    now: () => clock,
    schedule: (run) => scheduled.push(run),
  });
  return {
    gate,
    delivered,
    tick(to: number) {
      clock = to;
    },
    flush() {
      for (const run of scheduled.splice(0)) run();
    },
    emit(label: string, threadId: string, createdAt: number | null) {
      gate.deliver({ threadId, createdAt: () => createdAt }, () =>
        delivered.push(label),
      );
    },
  };
}

describe("thread event gate", () => {
  it("delivers events for threads created before a pending call at once", () => {
    const test = harness();
    const call = deferred<void>();
    void test.gate.track(() => call.promise);

    test.emit("old idle", "thr_old", 99);

    expect(test.delivered).toEqual(["old idle"]);
  });

  it("holds a new thread's events, in order, until the call returns", async () => {
    const test = harness();
    const call = deferred<{ id: string }>();
    const tracked = test.gate.track(() => call.promise);

    test.emit("created", "thr_new", 100);
    test.emit("queued", "thr_new", null);
    test.emit("failed", "thr_new", 100);
    expect(test.delivered).toEqual([]);

    call.resolve({ id: "thr_new" });
    await tracked;
    test.flush();

    expect(test.delivered).toEqual(["created", "queued", "failed"]);
  });

  it("keeps holding while an earlier call that could have created the thread is pending", async () => {
    const test = harness();
    const first = deferred<void>();
    const second = deferred<void>();
    const firstTracked = test.gate.track(() => first.promise);
    test.tick(150);
    const secondTracked = test.gate.track(() => second.promise);
    test.tick(160);

    test.emit("from either call", "thr_a", 160);
    test.emit("from the first call only", "thr_b", 120);

    second.resolve();
    await secondTracked;
    test.flush();
    expect(test.delivered).toEqual([]);

    first.resolve();
    await firstTracked;
    test.flush();
    expect(test.delivered).toEqual([
      "from either call",
      "from the first call only",
    ]);
  });

  it("releases held events when the call rejects", async () => {
    const test = harness();
    const call = deferred<void>();
    const tracked = test.gate.track(() =>
      call.promise.then(() => {
        throw new Error("spawn failed");
      }),
    );

    test.emit("failed", "thr_new", 100);
    call.resolve();
    await expect(tracked).rejects.toThrow("spawn failed");
    test.flush();

    expect(test.delivered).toEqual(["failed"]);
  });
});
