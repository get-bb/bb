import type {
  ParcelAsyncSubscription,
  ParcelWatcherBackend,
  ParcelWatcherError,
  ParcelWatcherEventBatch,
  ParcelWatcherSubscribeOptions,
} from "../parcel-watcher-backend.js";
import type {
  ChildToParentMessage,
  ParentToChildMessage,
  SerializedParcelEvent,
} from "./messages.js";

/**
 * Parent-side handle on one watcher child. Abstracts `child_process.fork` so the
 * proxy's lifecycle logic can be tested against an in-memory child.
 */
export interface ChildChannel {
  send(message: ParentToChildMessage): void;
  onMessage(listener: (message: ChildToParentMessage) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

type ProxyLogLevel = "info" | "warn" | "error";

export interface ParcelWatcherProxyOptions {
  spawnChannel: () => ChildChannel;
  /** How often to ping the child to detect a wedged (e.g. deadlocked) process. */
  pingIntervalMs?: number;
  /** Kill + respawn the child if no pong arrives within this window. */
  pingTimeoutMs?: number;
  /** Stop respawning after this many restarts inside {@link restartWindowMs}. */
  maxRestartsPerWindow?: number;
  restartWindowMs?: number;
  log?: (
    level: ProxyLogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ) => void;
}

type SubscribeCallback = (
  error: ParcelWatcherError,
  events: ParcelWatcherEventBatch,
) => unknown;

interface SubscriptionRecord {
  id: string;
  dir: string;
  opts?: ParcelWatcherSubscribeOptions;
  callback: SubscribeCallback;
}

export interface ParcelWatcherProxy extends ParcelWatcherBackend {
  dispose(): void;
}

const DEFAULT_PING_INTERVAL_MS = 5_000;
const DEFAULT_PING_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESTARTS_PER_WINDOW = 5;
const DEFAULT_RESTART_WINDOW_MS = 60_000;

function toEventBatch(
  events: SerializedParcelEvent[],
): ParcelWatcherEventBatch {
  return events.map((event) => ({ path: event.path, type: event.type }));
}

/**
 * A {@link ParcelWatcherBackend} that runs the real parcel watcher in a child
 * process. The registry of active subscriptions is the source of truth: when
 * the child dies or stops answering pings, the proxy SIGKILLs it (the OS
 * reclaims the leaked inotify fds and parked threads atomically), spawns a
 * fresh child, and replays every subscription under its original id — so
 * callers (RootSubscription and up) never observe the restart.
 */
export function createParcelWatcherProxy(
  options: ParcelWatcherProxyOptions,
): ParcelWatcherProxy {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const maxRestartsPerWindow =
    options.maxRestartsPerWindow ?? DEFAULT_MAX_RESTARTS_PER_WINDOW;
  const restartWindowMs = options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;
  const log = options.log ?? (() => {});

  const subscriptions = new Map<string, SubscriptionRecord>();
  const restartTimestamps: number[] = [];
  let channel: ChildChannel | null = null;
  let disposed = false;
  let givenUp = false;
  // True while the current child is a replacement for a dead one, so its
  // replayed subscriptions request a gap-closing rescan. False for the first
  // child, whose subscriptions are fresh and have missed nothing.
  let restarting = false;
  let idCounter = 0;
  let pingNonce = 0;
  let lastPongAt = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  function nextId(): string {
    idCounter += 1;
    return `sub_${idCounter}`;
  }

  function stopPing(): void {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function startPing(): void {
    stopPing();
    lastPongAt = Date.now();
    pingTimer = setInterval(() => {
      if (channel === null) {
        return;
      }
      if (Date.now() - lastPongAt > pingTimeoutMs) {
        log("warn", "Watcher child unresponsive; killing", {
          sinceLastPongMs: Date.now() - lastPongAt,
        });
        killAndRestart();
        return;
      }
      pingNonce += 1;
      channel.send({ kind: "ping", nonce: pingNonce });
    }, pingIntervalMs);
  }

  function replaySubscriptions(rescan: boolean): void {
    if (channel === null) {
      return;
    }
    for (const record of subscriptions.values()) {
      channel.send({
        kind: "subscribe",
        id: record.id,
        dir: record.dir,
        opts: record.opts,
        rescan,
      });
    }
  }

  function failAllSubscriptions(message: string): void {
    const error = new Error(message);
    for (const record of subscriptions.values()) {
      record.callback(error, []);
    }
  }

  function startChild(): void {
    if (disposed || givenUp) {
      return;
    }
    const spawned = options.spawnChannel();
    channel = spawned;
    spawned.onMessage((message) => handleChildMessage(spawned, message));
    spawned.onExit(() => handleChildExit(spawned));
  }

  function recordRestartAndCheckBudget(): boolean {
    const now = Date.now();
    while (
      restartTimestamps.length > 0 &&
      now - (restartTimestamps[0] ?? now) > restartWindowMs
    ) {
      restartTimestamps.shift();
    }
    restartTimestamps.push(now);
    if (restartTimestamps.length > maxRestartsPerWindow) {
      givenUp = true;
      log("error", "Watcher child restart budget exhausted; giving up", {
        restarts: restartTimestamps.length,
        windowMs: restartWindowMs,
      });
      failAllSubscriptions(
        "Watcher subprocess is unavailable (restart budget exhausted)",
      );
      return false;
    }
    return true;
  }

  function restartChild(): void {
    if (disposed || givenUp) {
      return;
    }
    if (!recordRestartAndCheckBudget()) {
      return;
    }
    restarting = true;
    startChild();
  }

  function killAndRestart(): void {
    if (channel === null) {
      return;
    }
    const dying = channel;
    // Detach first so the kill-triggered exit event is treated as stale and we
    // drive the restart exactly once from here.
    channel = null;
    stopPing();
    dying.kill();
    restartChild();
  }

  function handleChildExit(source: ChildChannel): void {
    if (source !== channel) {
      // A stale child we already detached (e.g. via killAndRestart).
      return;
    }
    channel = null;
    stopPing();
    if (disposed) {
      return;
    }
    log("warn", "Watcher child exited; respawning", {
      activeSubscriptions: subscriptions.size,
    });
    restartChild();
  }

  function handleChildMessage(
    source: ChildChannel,
    message: ChildToParentMessage,
  ): void {
    if (source !== channel) {
      return;
    }
    switch (message.kind) {
      case "ready":
        replaySubscriptions(restarting);
        restarting = false;
        startPing();
        break;
      case "pong":
        lastPongAt = Date.now();
        break;
      case "events": {
        const record = subscriptions.get(message.id);
        record?.callback(null, toEventBatch(message.events));
        break;
      }
      case "watch-error":
      case "subscribe-failed": {
        const record = subscriptions.get(message.id);
        record?.callback(new Error(message.message), []);
        break;
      }
      case "subscribed":
      case "unsubscribed":
        break;
    }
  }

  function subscribe(
    dir: string,
    callback: SubscribeCallback,
    opts?: ParcelWatcherSubscribeOptions,
  ): Promise<ParcelAsyncSubscription> {
    if (disposed) {
      return Promise.reject(new Error("Parcel watcher proxy is disposed"));
    }
    const id = nextId();
    subscriptions.set(id, { id, dir, opts, callback });
    if (channel !== null) {
      channel.send({ kind: "subscribe", id, dir, opts });
    } else {
      // First subscription (or post-give-up): spawn lazily; replay-on-ready
      // issues the subscribe once the child is up.
      startChild();
    }
    return Promise.resolve({
      async unsubscribe() {
        subscriptions.delete(id);
        channel?.send({ kind: "unsubscribe", id });
      },
    });
  }

  function dispose(): void {
    disposed = true;
    stopPing();
    subscriptions.clear();
    if (channel !== null) {
      const dying = channel;
      channel = null;
      dying.kill();
    }
  }

  return { subscribe, dispose };
}
