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

export interface ChildChannel {
  send(message: ParentToChildMessage): void;
  onMessage(listener: (message: ChildToParentMessage) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

type ProxyLogLevel = "info" | "warn" | "error";

interface ParcelWatcherProxyOptions {
  spawnChannel: () => ChildChannel;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  baseRestartDelayMs?: number;
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
const STARTUP_TIMEOUT_MS = 15_000;
const MAX_CONSECUTIVE_RESTARTS = 5;

function toEventBatch(
  events: SerializedParcelEvent[],
): ParcelWatcherEventBatch {
  return events.map((event) => ({ path: event.path, type: event.type }));
}

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
  let terminalError: Error | null = null;
  let consecutiveRestarts = 0;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let respawnTimer: ReturnType<typeof setTimeout> | null = null;
  let restarting = false;
  let idCounter = 0;
  let pingNonce = 0;
  let lastPongAt = 0;
  let lastPingTickAt = 0;
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

  function stopStartupTimer(): void {
    if (startupTimer !== null) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
  }

  function failSubscriptions(): void {
    terminalError = new Error(
      `Filesystem watcher unavailable after ${MAX_CONSECUTIVE_RESTARTS + 1} consecutive child failures. ` +
        "Live file updates are disabled. Update or repair BB, then restart the BB host daemon to retry.",
    );
    log("error", terminalError.message, {
      activeSubscriptions: subscriptions.size,
    });
    const failed = [...subscriptions.values()];
    subscriptions.clear();
    for (const record of failed) {
      try {
        record.callback(terminalError, []);
      } catch (error) {
        log(
          "warn",
          "Watcher subscriber failed while reporting unavailability",
          {
            watchError: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  function startPing(): void {
    stopPing();
    const now = Date.now();
    lastPongAt = now;
    lastPingTickAt = now;
    pingTimer = setInterval(() => {
      if (channel === null) {
        return;
      }
      const now = Date.now();
      const sinceLastPingTickMs = now - lastPingTickAt;
      lastPingTickAt = now;
      if (sinceLastPingTickMs > pingIntervalMs + pingTimeoutMs) {
        lastPongAt = now;
        pingNonce += 1;
        channel.send({ kind: "ping", nonce: pingNonce });
        return;
      }
      if (now - lastPongAt > pingTimeoutMs) {
        log("warn", "Watcher child unresponsive; killing", {
          sinceLastPongMs: now - lastPongAt,
        });
        killAndRespawn();
        return;
      }
      pingNonce += 1;
      channel.send({ kind: "ping", nonce: pingNonce });
    }, pingIntervalMs);
    pingTimer.unref?.();
  }

  function replaySubscriptions(rescan: boolean): void {
    const target = channel;
    if (target === null) {
      return;
    }
    for (const record of subscriptions.values()) {
      target.send({
        kind: "subscribe",
        id: record.id,
        dir: record.dir,
        opts: record.opts,
        rescan,
      });
    }
  }

  function startChild(): void {
    if (disposed || terminalError !== null) {
      return;
    }
    childReady = false;
    let spawned: ChildChannel;
    try {
      spawned = options.spawnChannel();
    } catch (error) {
      log("warn", "Watcher child could not start", {
        watchError: error instanceof Error ? error.message : String(error),
      });
      scheduleRespawn();
      return;
    }
    channel = spawned;
    startupTimer = setTimeout(() => {
      log("warn", "Watcher child did not become ready; killing");
      killAndRespawn();
    }, STARTUP_TIMEOUT_MS);
    startupTimer.unref?.();
    spawned.onMessage((message) => handleChildMessage(spawned, message));
    spawned.onExit(() => handleChildExit(spawned));
  }

  function scheduleRespawn(): void {
    if (
      disposed ||
      terminalError !== null ||
      channel !== null ||
      respawnTimer !== null
    ) {
      return;
    }
    if (consecutiveRestarts >= MAX_CONSECUTIVE_RESTARTS) {
      failSubscriptions();
      return;
    }
    restarting = true;
    if (consecutiveRestarts === 0) {
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
    channel = null;
    childReady = false;
    stopStartupTimer();
    stopPing();
    dying.kill();
    scheduleRespawn();
  }

  function handleChildExit(source: ChildChannel): void {
    if (source !== channel) {
      return;
    }
    channel = null;
    childReady = false;
    stopStartupTimer();
    stopPing();
    if (disposed) {
      return;
    }
    log("warn", "Watcher child exited", {
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
        stopStartupTimer();
        childReady = true;
        replaySubscriptions(restarting);
        if (source !== channel) {
          return;
        }
        restarting = false;
        startPing();
        break;
      case "pong":
        lastPongAt = Date.now();
        consecutiveRestarts = 0;
        break;
      case "events": {
        const record = subscriptions.get(message.id);
        record?.callback(null, toEventBatch(message.events));
        break;
      }
      case "watch-error":
        if (message.recovery === "rescan-subscription") {
          const record = subscriptions.get(message.id);
          if (record) {
            log("warn", "Watcher subscription requires targeted recovery", {
              activeSubscriptions: subscriptions.size,
              watchError: message.message,
            });
            record.callback(new Error(message.message), []);
          }
          break;
        }
        log("warn", "Watcher child reported a backend error; recycling", {
          watchError: message.message,
        });
        killAndRespawn();
        break;
      case "subscribe-failed": {
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
    if (terminalError !== null) {
      callback(terminalError, []);
      return Promise.resolve({ async unsubscribe() {} });
    }
    const id = nextId();
    subscriptions.set(id, { id, dir, opts, callback });
    if (channel !== null && childReady) {
      channel.send({ kind: "subscribe", id, dir, opts, rescan: false });
    } else if (channel === null && respawnTimer === null) {
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
    stopStartupTimer();
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
