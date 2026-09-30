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
import {
  disposeParcelWatcherBackend,
  setParcelWatcherBackend,
  type ParcelWatcherBackend,
  type ParcelWatcherError,
  type ParcelWatcherEventBatch,
} from "../src/parcel-watcher-backend.js";
import * as pathExistsModule from "../src/path-exists.js";
import { RootSubscription } from "../src/root-subscription.js";
import { RESCAN_REQUIRED_MESSAGE } from "../src/watch-recovery.js";

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

class FakeParcel implements ParcelWatcherBackend {
  readonly subscriptions: FakeSubscription[] = [];
  readonly subscribeAttempts: string[] = [];
  nextSubscribeFailure: string | null = null;
  failAllSubscribesWith: string | null = null;
  subscribeGate: Promise<void> | null = null;
  unsubscribeGate: Promise<void> | null = null;

  async subscribe(
    dir: string,
    callback: (
      error: ParcelWatcherError,
      events: ParcelWatcherEventBatch,
    ) => unknown,
  ): Promise<{ unsubscribe(): Promise<void> }> {
    this.subscribeAttempts.push(dir);
    if (this.subscribeGate !== null) {
      await this.subscribeGate;
    }
    const failure = this.failAllSubscribesWith ?? this.nextSubscribeFailure;
    if (failure !== null) {
      this.nextSubscribeFailure = null;
      throw new Error(failure);
    }
    const subscription: FakeSubscription = {
      dir,
      callback,
      unsubscribed: false,
    };
    this.subscriptions.push(subscription);
    return {
      unsubscribe: async () => {
        if (this.unsubscribeGate !== null) {
          await this.unsubscribeGate;
        }
        subscription.unsubscribed = true;
      },
    };
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

class FakeChild {
  readonly parcel = new FakeParcel();
  readonly channel: ChildChannel;
  exited = false;
  responsive = true;
  dieOnSend = false;

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
        if (this.dieOnSend) {
          this.exit();
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
  unsubscribeTimeoutMs?: number;
  baseRestartDelayMs?: number;
  maxRestartDelayMs?: number;
  listEntries?: (dir: string) => Promise<string[]>;
  configureChild?: (child: FakeChild) => void;
}) {
  const children: FakeChild[] = [];
  const listEntries = options?.listEntries ?? (() => Promise.resolve([]));
  const proxy = createParcelWatcherProxy({
    spawnChannel: () => {
      const child = new FakeChild(listEntries);
      options?.configureChild?.(child);
      children.push(child);
      return child.channel;
    },
    pingIntervalMs: options?.pingIntervalMs ?? 1_000,
    pingTimeoutMs: options?.pingTimeoutMs ?? 2_500,
    unsubscribeTimeoutMs: options?.unsubscribeTimeoutMs ?? 2_500,
    baseRestartDelayMs: options?.baseRestartDelayMs ?? 1_000,
    maxRestartDelayMs: options?.maxRestartDelayMs ?? 30_000,
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

    current().exit();
    await flush();

    expect(children).toHaveLength(2);
    expect(current().parcel.activeDirs()).toEqual(["/root"]);

    current().parcel.emit("/root", [
      { path: "/root/after.ts", type: "update" },
    ]);
    expect(received).toEqual(["/root/after.ts"]);
    expect(errorCount).toBe(0);

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

    current().parcel.emitError(
      "/root",
      "Unable to poll: Interrupted system call",
    );
    await flush();

    expect(children[0]?.exited).toBe(true);
    expect(children).toHaveLength(2);
    expect(current().parcel.activeDirs()).toEqual(["/root"]);
    expect(errorCount).toBe(0);

    current().parcel.emit("/root", [
      { path: "/root/healed.ts", type: "update" },
    ]);
    expect(received).toEqual(["/root/healed.ts"]);
    proxy.dispose();
  });

  it("routes rescan-required errors only to the affected subscription", async () => {
    const listEntries = vi.fn(() => Promise.resolve(["current-entry"]));
    const { proxy, children, current } = createHarness({ listEntries });
    const affectedErrors: string[] = [];
    const affectedEvents: string[] = [];
    const unaffectedErrors: string[] = [];
    const unaffectedEvents: string[] = [];

    await proxy.subscribe("/affected", (error, events) => {
      if (error) {
        affectedErrors.push(error.message);
        return;
      }
      affectedEvents.push(...events.map((event) => event.path));
    });
    await proxy.subscribe("/unaffected", (error, events) => {
      if (error) {
        unaffectedErrors.push(error.message);
        return;
      }
      unaffectedEvents.push(...events.map((event) => event.path));
    });
    await flush();
    expect(children).toHaveLength(1);

    current().parcel.emitError(
      "/affected",
      `Events were dropped by the FSEvents client. ${RESCAN_REQUIRED_MESSAGE}.`,
    );
    await flush();

    expect(children).toHaveLength(1);
    expect(affectedErrors).toEqual([
      `Events were dropped by the FSEvents client. ${RESCAN_REQUIRED_MESSAGE}.`,
    ]);
    expect(affectedEvents).toEqual([]);
    expect(unaffectedErrors).toEqual([]);
    expect(unaffectedEvents).toEqual([]);
    expect(listEntries).not.toHaveBeenCalled();
    expect(current().parcel.activeDirs().sort()).toEqual([
      "/affected",
      "/unaffected",
    ]);
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
    expect(received).toEqual([]);

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

      current().responsive = false;
      await vi.advanceTimersByTimeAsync(3_500);

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

  it("probes instead of killing when the parent ping timer resumes late", async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(0);
      const { proxy, children, current } = createHarness({
        pingIntervalMs: 1_000,
        pingTimeoutMs: 2_500,
      });
      await proxy.subscribe("/root", () => {});
      await flush();
      expect(children).toHaveLength(1);

      nowSpy.mockReturnValue(4_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await flush();

      expect(children[0]?.exited).toBe(false);
      expect(children).toHaveLength(1);
      expect(current().parcel.activeDirs()).toEqual(["/root"]);
      proxy.dispose();
    } finally {
      nowSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("backs off a rapid respawn but never permanently gives up", async () => {
    vi.useFakeTimers();
    try {
      const { proxy, children, current } = createHarness({
        baseRestartDelayMs: 1_000,
        maxRestartDelayMs: 8_000,
        pingIntervalMs: 100_000,
      });
      let terminalError: Error | null = null;
      await proxy.subscribe("/root", (error) => {
        if (error) {
          terminalError = error;
        }
      });
      await flush();
      expect(children).toHaveLength(1);

      current().exit();
      await flush();
      expect(children).toHaveLength(2);

      current().exit();
      await flush();
      expect(children).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(children).toHaveLength(3);

      expect(terminalError).toBeNull();
      proxy.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers when a replacement child's pipe breaks mid-replay", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { proxy, children, current } = createHarness({
        baseRestartDelayMs: 1_000,
        pingIntervalMs: 100_000,
        listEntries: () => Promise.resolve(["gap-file"]),
      });
      await proxy.subscribe("/root", (error, events) => {
        if (!error) {
          received.push(...events.map((event) => event.path));
        }
      });
      await proxy.subscribe("/other", (error, events) => {
        if (!error) {
          received.push(...events.map((event) => event.path));
        }
      });
      await flush();
      expect(children).toHaveLength(1);

      current().exit();
      expect(children).toHaveLength(2);

      current().dieOnSend = true;
      await flush();

      await vi.advanceTimersByTimeAsync(1_000);
      await flush();

      expect(children).toHaveLength(3);
      expect(current().parcel.activeDirs().sort()).toEqual(["/other", "/root"]);
      expect(received.sort()).toEqual(["/other/gap-file", "/root/gap-file"]);
      proxy.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves subscribe only after the child has established the native subscription", async () => {
    const { proxy, current } = createHarness();
    let releaseNativeSubscribe!: () => void;
    const pending = proxy.subscribe("/root", () => {});
    current().parcel.subscribeGate = new Promise<void>((resolve) => {
      releaseNativeSubscribe = resolve;
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await flush(20);
    expect(current().parcel.subscribeAttempts).toEqual(["/root"]);
    expect(settled).toBe(false);

    releaseNativeSubscribe();
    await flush(20);
    expect(settled).toBe(true);
    proxy.dispose();
  });

  it("rejects a subscribe the child cannot establish and never replays it", async () => {
    const { proxy, children, current } = createHarness();
    const callbackErrors: string[] = [];
    const pending = proxy.subscribe("/root", (error) => {
      if (error) {
        callbackErrors.push(error.message);
      }
    });
    current().parcel.nextSubscribeFailure = "cannot watch /root";

    await expect(pending).rejects.toThrow("cannot watch /root");
    expect(callbackErrors).toEqual([]);
    expect(children).toHaveLength(1);

    current().exit();
    await flush();
    expect(children).toHaveLength(2);
    expect(current().parcel.subscribeAttempts).toEqual([]);
    proxy.dispose();
  });

  it("surfaces a replay subscribe failure as recoverable, not terminal", async () => {
    const { proxy, children, current } = createHarness();
    const errors: string[] = [];
    await proxy.subscribe("/root", (error) => {
      if (error) {
        errors.push(error.message);
      }
    });
    current().exit();
    expect(children).toHaveLength(2);
    current().parcel.nextSubscribeFailure = "cannot watch /root";
    await flush(20);

    expect(errors).toEqual([RESCAN_REQUIRED_MESSAGE]);
    expect(current().parcel.activeDirs()).toEqual([]);
    proxy.dispose();
  });

  it("recycles the child after a subscribe that leaked native watches, replaying only healthy subscriptions", async () => {
    const { proxy, children, current } = createHarness();
    await proxy.subscribe("/healthy", () => {});
    const failure =
      "inotify_add_watch on '/huge/node_modules/pkg' failed: No space left on device";
    current().parcel.nextSubscribeFailure = failure;

    await expect(proxy.subscribe("/huge", () => {})).rejects.toThrow(failure);
    await flush(20);

    expect(children).toHaveLength(2);
    expect(children[0]?.exited).toBe(true);
    expect(current().parcel.activeDirs()).toEqual(["/healthy"]);
    proxy.dispose();
  });

  it("replays a subscribe that was still pending when the child died", async () => {
    const { proxy, children, current } = createHarness();
    const pending = proxy.subscribe("/root", () => {});
    current().parcel.subscribeGate = new Promise<void>(() => {});
    await flush(20);

    current().exit();
    await pending;

    expect(children).toHaveLength(2);
    expect(current().parcel.activeDirs()).toEqual(["/root"]);
    proxy.dispose();
  });

  it("rejects pending subscribes when the proxy is disposed", async () => {
    const { proxy, current } = createHarness();
    const pending = proxy.subscribe("/root", () => {});
    current().parcel.subscribeGate = new Promise<void>(() => {});
    await flush(20);

    proxy.dispose();

    await expect(pending).rejects.toThrow("Parcel watcher proxy is disposed");
  });

  it("settles root disposal while native subscribe is pending", async () => {
    vi.spyOn(pathExistsModule, "pathExists").mockResolvedValue(true);
    const subscribeGate = new Promise<void>(() => {});
    const { proxy, current } = createHarness({
      configureChild: (child) => {
        child.parcel.subscribeGate = subscribeGate;
      },
    });
    setParcelWatcherBackend(proxy);
    const subscription = new RootSubscription({
      rootPath: "/root",
      retryDelayMs: 250,
      maxRetryDelayMs: 30_000,
      onEvents: () => {},
      onDroppedEvents: () => {},
      onWatchError: () => {},
    });
    try {
      subscription.start();
      await flush(20);
      expect(current().parcel.subscribeAttempts).toEqual(["/root"]);

      await subscription.dispose();
    } finally {
      disposeParcelWatcherBackend();
      vi.restoreAllMocks();
    }
  });

  it("resolves unsubscribe only after the child released the native subscription", async () => {
    const { proxy, current } = createHarness();
    const subscription = await proxy.subscribe("/root", () => {});
    let releaseNativeUnsubscribe!: () => void;
    current().parcel.unsubscribeGate = new Promise<void>((resolve) => {
      releaseNativeUnsubscribe = resolve;
    });
    let settled = false;
    void subscription.unsubscribe().then(() => {
      settled = true;
    });
    await flush(20);
    expect(settled).toBe(false);

    releaseNativeUnsubscribe();
    await flush(20);
    expect(settled).toBe(true);
    expect(current().parcel.activeDirs()).toEqual([]);
    proxy.dispose();
  });

  it("releases a pending unsubscribe when the child exits", async () => {
    const { proxy, current } = createHarness({ pingIntervalMs: 100_000 });
    const subscription = await proxy.subscribe("/root", () => {});
    current().parcel.unsubscribeGate = new Promise<void>(() => {});
    const pending = subscription.unsubscribe();
    await flush(20);

    current().exit();

    await pending;
    expect(current().parcel.activeDirs()).toEqual([]);
    proxy.dispose();
  });

  it("recycles a child whose native unsubscribe does not settle", async () => {
    vi.useFakeTimers();
    try {
      const { proxy, children, current } = createHarness({
        pingIntervalMs: 100_000,
        unsubscribeTimeoutMs: 1_000,
      });
      const subscription = await proxy.subscribe("/root", () => {});
      current().parcel.unsubscribeGate = new Promise<void>(() => {});
      const pending = subscription.unsubscribe();
      await flush(20);

      await vi.advanceTimersByTimeAsync(1_000);
      await pending;

      expect(children).toHaveLength(2);
      expect(children[0]?.exited).toBe(true);
      expect(current().parcel.activeDirs()).toEqual([]);
      proxy.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off a root whose subscribe keeps hitting the inotify watch limit", async () => {
    vi.useFakeTimers();
    vi.spyOn(pathExistsModule, "pathExists").mockResolvedValue(true);
    const failure =
      "inotify_add_watch on '/huge/node_modules/pkg' failed: No space left on device";
    const { proxy, children } = createHarness({
      configureChild: (child) => {
        child.parcel.failAllSubscribesWith = failure;
      },
    });
    setParcelWatcherBackend(proxy);
    const watchErrors: string[] = [];
    let droppedEvents = 0;
    const subscription = new RootSubscription({
      rootPath: "/huge",
      retryDelayMs: 250,
      maxRetryDelayMs: 30_000,
      onEvents: () => {},
      onDroppedEvents: () => {
        droppedEvents += 1;
      },
      onWatchError: (message) => {
        watchErrors.push(message);
      },
    });
    try {
      subscription.start();
      await vi.advanceTimersByTimeAsync(60_000);

      const attempts = children.reduce(
        (total, child) => total + child.parcel.subscribeAttempts.length,
        0,
      );
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(attempts).toBeLessThanOrEqual(10);
      expect(children.length).toBeLessThanOrEqual(attempts + 1);
      expect(droppedEvents).toBe(0);
      expect(watchErrors).toEqual([
        `${failure} (inotify watch limit reached; see fs.inotify.max_user_watches)`,
      ]);
    } finally {
      disposeParcelWatcherBackend();
      await subscription.dispose();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("does not double-subscribe a subscription added during the respawn window", async () => {
    const { proxy, children, current } = createHarness();
    await proxy.subscribe("/root", () => {});
    await flush();
    expect(children).toHaveLength(1);

    current().exit();
    await proxy.subscribe("/late", () => {});
    await flush();

    expect(children).toHaveLength(2);
    expect(
      current()
        .parcel.activeDirs()
        .filter((d) => d === "/late"),
    ).toEqual(["/late"]);
    expect(
      current()
        .parcel.activeDirs()
        .filter((d) => d === "/root"),
    ).toEqual(["/root"]);
    proxy.dispose();
  });
});
