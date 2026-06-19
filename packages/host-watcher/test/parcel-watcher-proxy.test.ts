import { describe, expect, it, vi } from "vitest";
import type {
  ChildToParentMessage,
  ParentToChildMessage,
} from "../src/parcel-subprocess/messages.js";
import { createParcelChildHandler } from "../src/parcel-subprocess/parcel-child-handler.js";
import {
  createParcelWatcherProxy,
  type ChildChannel,
} from "../src/parcel-subprocess/parcel-watcher-proxy.js";
import type {
  ParcelWatcherBackend,
  ParcelWatcherError,
  ParcelWatcherEventBatch,
} from "../src/parcel-watcher-backend.js";

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

interface FakeSubscription {
  dir: string;
  callback: (
    error: ParcelWatcherError,
    events: ParcelWatcherEventBatch,
  ) => unknown;
  unsubscribed: boolean;
}

/** Stand-in for the real @parcel/watcher running inside a child. */
class FakeParcel implements ParcelWatcherBackend {
  readonly subscriptions: FakeSubscription[] = [];
  failNextSubscribe = false;

  subscribe(
    dir: string,
    callback: (
      error: ParcelWatcherError,
      events: ParcelWatcherEventBatch,
    ) => unknown,
  ): Promise<{ unsubscribe(): Promise<void> }> {
    if (this.failNextSubscribe) {
      this.failNextSubscribe = false;
      return Promise.reject(new Error(`cannot watch ${dir}`));
    }
    const subscription: FakeSubscription = {
      dir,
      callback,
      unsubscribed: false,
    };
    this.subscriptions.push(subscription);
    return Promise.resolve({
      unsubscribe: () => {
        subscription.unsubscribed = true;
        return Promise.resolve();
      },
    });
  }

  emit(dir: string, events: ParcelWatcherEventBatch): void {
    for (const subscription of this.subscriptions) {
      if (subscription.dir === dir && !subscription.unsubscribed) {
        subscription.callback(null, events);
      }
    }
  }

  emitError(dir: string, message: string): void {
    for (const subscription of this.subscriptions) {
      if (subscription.dir === dir && !subscription.unsubscribed) {
        subscription.callback(new Error(message), []);
      }
    }
  }

  activeDirs(): string[] {
    return this.subscriptions
      .filter((subscription) => !subscription.unsubscribed)
      .map((subscription) => subscription.dir);
  }
}

/** One fake child: a parcel handler wired to an in-memory ChildChannel. */
class FakeChild {
  readonly parcel = new FakeParcel();
  readonly channel: ChildChannel;
  exited = false;
  responsive = true;

  private readonly handler;
  private parentListener: ((message: ChildToParentMessage) => void) | null =
    null;
  private exitListener: (() => void) | null = null;

  constructor(listEntries: (dir: string) => Promise<string[]>) {
    this.handler = createParcelChildHandler({
      parcel: this.parcel,
      send: (message) => this.parentListener?.(message),
      listEntries,
    });
    this.channel = {
      send: (message: ParentToChildMessage) => {
        if (this.exited || !this.responsive) {
          return;
        }
        this.handler.handleMessage(message);
      },
      onMessage: (listener) => {
        this.parentListener = listener;
      },
      onExit: (listener) => {
        this.exitListener = listener;
      },
      kill: () => this.exit(),
    };
    // Announce readiness once the parent has attached its listeners.
    queueMicrotask(() => {
      if (!this.exited) {
        this.parentListener?.({ kind: "ready" });
      }
    });
  }

  exit(): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.exitListener?.();
  }
}

function createHarness(options?: {
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  maxRestartsPerWindow?: number;
  restartWindowMs?: number;
  listEntries?: (dir: string) => Promise<string[]>;
}) {
  const children: FakeChild[] = [];
  const listEntries = options?.listEntries ?? (() => Promise.resolve([]));
  const proxy = createParcelWatcherProxy({
    spawnChannel: () => {
      const child = new FakeChild(listEntries);
      children.push(child);
      return child.channel;
    },
    pingIntervalMs: options?.pingIntervalMs ?? 1_000,
    pingTimeoutMs: options?.pingTimeoutMs ?? 2_500,
    maxRestartsPerWindow: options?.maxRestartsPerWindow ?? 3,
    restartWindowMs: options?.restartWindowMs ?? 60_000,
  });
  const current = (): FakeChild => {
    const child = children.at(-1);
    if (!child) {
      throw new Error("no child spawned yet");
    }
    return child;
  };
  return { proxy, children, current };
}

describe("createParcelWatcherProxy", () => {
  it("delivers parcel events from the child to the subscriber", async () => {
    const { proxy, current } = createHarness();
    const received: ParcelWatcherEventBatch[] = [];
    await proxy.subscribe("/root", (error, events) => {
      if (!error) {
        received.push(events);
      }
    });
    await flush();

    current().parcel.emit("/root", [{ path: "/root/a.ts", type: "update" }]);

    expect(received).toEqual([[{ path: "/root/a.ts", type: "update" }]]);
    proxy.dispose();
  });

  it("propagates unsubscribe through to the child", async () => {
    const { proxy, current } = createHarness();
    const received: ParcelWatcherEventBatch[] = [];
    const subscription = await proxy.subscribe("/root", (error, events) => {
      if (!error) {
        received.push(events);
      }
    });
    await flush();

    await subscription.unsubscribe();
    await flush();
    expect(current().parcel.activeDirs()).toEqual([]);

    current().parcel.emit("/root", [{ path: "/root/a.ts", type: "create" }]);
    expect(received).toEqual([]);
    proxy.dispose();
  });

  it("respawns the child and replays subscriptions transparently on crash", async () => {
    const { proxy, children, current } = createHarness();
    const received: string[] = [];
    let errorCount = 0;
    const subscription = await proxy.subscribe("/root", (error, events) => {
      if (error) {
        errorCount += 1;
        return;
      }
      for (const event of events) {
        received.push(event.path);
      }
    });
    await flush();
    expect(children).toHaveLength(1);

    // The child dies (e.g. parcel deadlocked and the proxy SIGKILLed it).
    current().exit();
    await flush();

    // A fresh child is spawned and the subscription replayed onto it...
    expect(children).toHaveLength(2);
    expect(current().parcel.activeDirs()).toEqual(["/root"]);

    // ...and events resume without the caller re-subscribing or seeing an error.
    current().parcel.emit("/root", [
      { path: "/root/after.ts", type: "update" },
    ]);
    expect(received).toEqual(["/root/after.ts"]);
    expect(errorCount).toBe(0);

    // The original handle is still valid after the restart.
    await subscription.unsubscribe();
    await flush();
    expect(current().parcel.activeDirs()).toEqual([]);
    proxy.dispose();
  });

  it("recycles the child and replays when it reports a backend error (EINTR)", async () => {
    const { proxy, children, current } = createHarness();
    const received: string[] = [];
    let errorCount = 0;
    await proxy.subscribe("/root", (error, events) => {
      if (error) {
        errorCount += 1;
        return;
      }
      for (const event of events) {
        received.push(event.path);
      }
    });
    await flush();
    expect(children).toHaveLength(1);

    // Parcel's shared backend dies in the child (inotify EINTR).
    current().parcel.emitError(
      "/root",
      "Unable to poll: Interrupted system call",
    );
    await flush();

    // The proxy SIGKILLed the child (reclaiming the leak) and replayed onto a
    // fresh one — without surfacing a terminal error to the caller.
    expect(children[0]?.exited).toBe(true);
    expect(children).toHaveLength(2);
    expect(current().parcel.activeDirs()).toEqual(["/root"]);
    expect(errorCount).toBe(0);

    // Events flow again on the fresh backend.
    current().parcel.emit("/root", [
      { path: "/root/healed.ts", type: "update" },
    ]);
    expect(received).toEqual(["/root/healed.ts"]);
    proxy.dispose();
  });

  it("re-emits current entries on replay to close the restart gap", async () => {
    const { proxy, current } = createHarness({
      listEntries: () => Promise.resolve(["thread-1", "thread-2"]),
    });
    const received: string[] = [];
    await proxy.subscribe("/storage", (error, events) => {
      if (!error) {
        for (const event of events) {
          received.push(event.path);
        }
      }
    });
    await flush();
    // Initial subscribe is fresh: no rescan, nothing missed.
    expect(received).toEqual([]);

    // Child dies; the replay onto the new child carries a rescan that re-emits
    // the root's current entries so callers reconcile changes missed in the gap.
    current().exit();
    await flush();
    expect([...received].sort()).toEqual([
      "/storage/thread-1",
      "/storage/thread-2",
    ]);
    proxy.dispose();
  });

  it("kills and respawns a child that stops answering pings", async () => {
    vi.useFakeTimers();
    try {
      const { proxy, children, current } = createHarness({
        pingIntervalMs: 1_000,
        pingTimeoutMs: 2_500,
      });
      const received: string[] = [];
      await proxy.subscribe("/root", (error, events) => {
        if (!error) {
          for (const event of events) {
            received.push(event.path);
          }
        }
      });
      await flush();
      expect(children).toHaveLength(1);

      // Child wedges: it stops processing messages (no pongs).
      current().responsive = false;
      await vi.advanceTimersByTimeAsync(3_500);

      // Liveness check kills it and brings up a replacement.
      expect(children[0]?.exited).toBe(true);
      expect(children).toHaveLength(2);
      expect(current().parcel.activeDirs()).toEqual(["/root"]);

      current().parcel.emit("/root", [{ path: "/root/x.ts", type: "create" }]);
      expect(received).toEqual(["/root/x.ts"]);
      proxy.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up and surfaces an error after the restart budget is exhausted", async () => {
    const { proxy, children } = createHarness({ maxRestartsPerWindow: 3 });
    let lastError: Error | null = null;
    await proxy.subscribe("/root", (error) => {
      if (error) {
        lastError = error;
      }
    });
    await flush();

    // Crash repeatedly: 3 restarts are allowed, the 4th crash trips give-up.
    for (let i = 0; i < 4; i += 1) {
      children.at(-1)?.exit();
      await flush();
    }
    expect(lastError).toBeInstanceOf(Error);
    expect((lastError as Error | null)?.message).toMatch(/restart budget/i);

    const countAtGiveUp = children.length;
    children.at(-1)?.exit();
    await flush();
    expect(children.length).toBe(countAtGiveUp);
    proxy.dispose();
  });
});
