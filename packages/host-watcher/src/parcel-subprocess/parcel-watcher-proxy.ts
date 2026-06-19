import type {
  ParcelAsyncSubscription,
  ParcelWatcherBackend,
  ParcelWatcherError,
  ParcelWatcherEventBatch,
  ParcelWatcherSubscribeOptions,
} from "../parcel-watcher-backend.js";
import { RESCAN_REQUIRED_MESSAGE } from "../watch-recovery.js";
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
  /** Base delay before respawning after a *consecutive* failure (the first
   * failure respawns immediately; only sustained churn backs off). */
  baseRestartDelayMs?: number;
  /** Cap on the exponential respawn backoff. */
  maxRestartDelayMs?: number;
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
const DEFAULT_BASE_RESTART_DELAY_MS = 250;
const DEFAULT_MAX_RESTART_DELAY_MS = 30_000;

function toEventBatch(
  events: SerializedParcelEvent[],
): ParcelWatcherEventBatch {
  return events.map((event) => ({ path: event.path, type: event.type }));
}

/**
 * A {@link ParcelWatcherBackend} that runs the real parcel watcher in a child
 * process. The registry of active subscriptions is the source of truth: when
 * the child dies, wedges, or reports a backend error, the proxy SIGKILLs it
 * (the OS reclaims the leaked inotify fds and parked threads atomically), spawns
 * a fresh child, and replays every subscription under its original id — so
 * callers (RootSubscription and up) never observe the restart.
 *
 * Respawns use a capped exponential backoff that resets once a child proves
 * healthy, so an EINTR storm cannot spin in a tight loop yet the watcher always
 * recovers when the storm subsides (it never permanently gives up).
 */
export function createParcelWatcherProxy(
  options: ParcelWatcherProxyOptions,
): ParcelWatcherProxy {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const baseRestartDelayMs =
    options.baseRestartDelayMs ?? DEFAULT_BASE_RESTART_DELAY_MS;
  const maxRestartDelayMs =
    options.maxRestartDelayMs ?? DEFAULT_MAX_RESTART_DELAY_MS;
  const log = options.log ?? (() => {});

  const subscriptions = new Map<string, SubscriptionRecord>();
  let channel: ChildChannel | null = null;
  let childReady = false;
  let disposed = false;
  // Counts back-to-back respawns with no healthy interval between them, to back
  // off an EINTR storm. Reset to 0 once a child proves healthy (answers a ping).
  let consecutiveRestarts = 0;
  let respawnTimer: ReturnType<typeof setTimeout> | null = null;
  // True while the current child is a replacement, so its replayed subscriptions
  // request a gap-closing rescan. False for the first child (nothing missed).
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
        killAndRespawn();
        return;
      }
      pingNonce += 1;
      channel.send({ kind: "ping", nonce: pingNonce });
    }, pingIntervalMs);
    // Never let the watcher's ping pin the daemon's event loop open on shutdown.
    pingTimer.unref?.();
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

  function startChild(): void {
    if (disposed) {
      return;
    }
    childReady = false;
    const spawned = options.spawnChannel();
    channel = spawned;
    spawned.onMessage((message) => handleChildMessage(spawned, message));
    spawned.onExit(() => handleChildExit(spawned));
  }

  function scheduleRespawn(): void {
    if (disposed || channel !== null || respawnTimer !== null) {
      return;
    }
    restarting = true;
    if (consecutiveRestarts === 0) {
      // A one-off failure heals instantly; only sustained churn backs off.
      consecutiveRestarts += 1;
      startChild();
      return;
    }
    const delay = Math.min(
      baseRestartDelayMs * 2 ** (consecutiveRestarts - 1),
      maxRestartDelayMs,
    );
    consecutiveRestarts += 1;
    log("warn", "Backing off before watcher child respawn", {
      delayMs: delay,
      consecutiveRestarts,
    });
    respawnTimer = setTimeout(() => {
      respawnTimer = null;
      startChild();
    }, delay);
    respawnTimer.unref?.();
  }

  function killAndRespawn(): void {
    if (channel === null) {
      return;
    }
    const dying = channel;
    // Detach first so the kill-triggered exit event is treated as stale and we
    // drive the respawn exactly once from here.
    channel = null;
    childReady = false;
    stopPing();
    dying.kill();
    scheduleRespawn();
  }

  function handleChildExit(source: ChildChannel): void {
    if (source !== channel) {
      // A stale child we already detached (e.g. via killAndRespawn).
      return;
    }
    channel = null;
    childReady = false;
    stopPing();
    if (disposed) {
      return;
    }
    log("warn", "Watcher child exited; respawning", {
      activeSubscriptions: subscriptions.size,
    });
    scheduleRespawn();
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
        childReady = true;
        replaySubscriptions(restarting);
        restarting = false;
        startPing();
        break;
      case "pong":
        lastPongAt = Date.now();
        // The child has proven healthy: reset the respawn backoff.
        consecutiveRestarts = 0;
        break;
      case "events": {
        const record = subscriptions.get(message.id);
        record?.callback(null, toEventBatch(message.events));
        break;
      }
      case "watch-error":
        // Parcel's shared inotify backend died in the child (e.g. an EINTR poll
        // interruption), which takes down every watch at once. Recycle the whole
        // child: the SIGKILL reclaims the leaked fds/threads, and the respawn
        // re-arms every subscription on a fresh backend — so the watch
        // self-heals instead of going permanently dead.
        log("warn", "Watcher child reported a backend error; recycling", {
          watchError: message.message,
        });
        killAndRespawn();
        break;
      case "subscribe-failed": {
        // One subscription failed to establish on the child — typically its path
        // is transiently missing while a respawn re-arms it. Surface it as
        // RECOVERABLE so RootSubscription re-establishes it through its
        // existence-gated, backed-off retry path, instead of the proxy turning a
        // transient ENOENT into a permanently dead watch.
        const record = subscriptions.get(message.id);
        record?.callback(new Error(RESCAN_REQUIRED_MESSAGE), []);
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
    if (channel !== null && childReady) {
      // Steady state: send now. Not replayed again unless the child respawns,
      // so there is exactly one subscribe per id per child.
      channel.send({ kind: "subscribe", id, dir, opts, rescan: false });
    } else if (channel === null && respawnTimer === null) {
      // No child yet and none pending: spawn one. replay-on-ready issues the
      // subscribe once it is up.
      startChild();
    }
    // Otherwise a child is spawning or backing off; replay-on-ready will send
    // this subscription exactly once when it becomes ready (no double-subscribe).
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
    if (respawnTimer !== null) {
      clearTimeout(respawnTimer);
      respawnTimer = null;
    }
    subscriptions.clear();
    if (channel !== null) {
      const dying = channel;
      channel = null;
      dying.kill();
    }
  }

  return { subscribe, dispose };
}
