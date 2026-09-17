import { calculateExponentialBackoffDelay } from "@bb/domain";
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
  unsubscribeTimeoutMs?: number;
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

interface SubscribeConfirmation {
  resolve: (subscription: ParcelAsyncSubscription) => void;
  reject: (error: Error) => void;
}

interface SubscriptionRecord {
  id: string;
  dir: string;
  opts?: ParcelWatcherSubscribeOptions;
  callback: SubscribeCallback;
  confirmation: SubscribeConfirmation | null;
  requestSource: ChildChannel | null;
  rescanSource: ChildChannel | null;
  signal: AbortSignal | null;
  abortListener: (() => void) | null;
}

interface PendingUnsubscribe {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ParcelWatcherProxy extends ParcelWatcherBackend {
  dispose(): void;
}

const DEFAULT_PING_INTERVAL_MS = 5_000;
const DEFAULT_PING_TIMEOUT_MS = 15_000;
const DEFAULT_UNSUBSCRIBE_TIMEOUT_MS = 15_000;
const DEFAULT_BASE_RESTART_DELAY_MS = 250;
const DEFAULT_MAX_RESTART_DELAY_MS = 30_000;

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
  const unsubscribeTimeoutMs =
    options.unsubscribeTimeoutMs ?? DEFAULT_UNSUBSCRIBE_TIMEOUT_MS;
  const baseRestartDelayMs =
    options.baseRestartDelayMs ?? DEFAULT_BASE_RESTART_DELAY_MS;
  const maxRestartDelayMs =
    options.maxRestartDelayMs ?? DEFAULT_MAX_RESTART_DELAY_MS;
  const log = options.log ?? (() => {});

  const subscriptions = new Map<string, SubscriptionRecord>();
  const pendingUnsubscribes = new Map<string, PendingUnsubscribe>();
  let channel: ChildChannel | null = null;
  let childReady = false;
  let disposed = false;
  let consecutiveRestarts = 0;
  let respawnTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryPending = false;
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

  function sendSubscribe(
    target: ChildChannel,
    record: SubscriptionRecord,
    rescan: boolean,
  ): void {
    record.requestSource = target;
    record.rescanSource = rescan ? target : null;
    target.send({
      kind: "subscribe",
      id: record.id,
      dir: record.dir,
      opts: record.opts,
      rescan,
    });
  }

  function replaySubscriptions(): void {
    const target = channel;
    if (target === null) {
      return;
    }
    const rescan = recoveryPending;
    for (const record of subscriptions.values()) {
      if (target !== channel) {
        return;
      }
      sendSubscribe(target, record, rescan);
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
    recoveryPending = true;
    if (consecutiveRestarts === 0) {
      consecutiveRestarts += 1;
      startChild();
      return;
    }
    const delay = calculateExponentialBackoffDelay({
      attempt: consecutiveRestarts,
      baseDelayMs: baseRestartDelayMs,
      maxDelayMs: maxRestartDelayMs,
    });
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
    stopPing();
    releasePendingUnsubscribes();
    releaseChildRequests(dying);
    dying.kill();
    scheduleRespawn();
  }

  function handleChildExit(source: ChildChannel): void {
    if (source !== channel) {
      return;
    }
    channel = null;
    childReady = false;
    stopPing();
    releasePendingUnsubscribes();
    releaseChildRequests(source);
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
        replaySubscriptions();
        if (source === channel) {
          startPing();
        }
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
      case "subscribed": {
        const record = subscriptions.get(message.id);
        if (record?.rescanSource === source) {
          record.rescanSource = null;
          recoveryPending = false;
        }
        const confirmation = record?.confirmation ?? null;
        if (record && confirmation) {
          record.confirmation = null;
          releaseAbortListener(record);
          confirmation.resolve(createSubscriptionHandle(record.id));
        }
        break;
      }
      case "subscribe-failed": {
        const record = subscriptions.get(message.id);
        if (record) {
          subscriptions.delete(message.id);
          releaseAbortListener(record);
          if (record.confirmation) {
            record.confirmation.reject(new Error(message.message));
          } else {
            record.callback(new Error(RESCAN_REQUIRED_MESSAGE), []);
          }
        }
        if (message.recovery === "recycle-child") {
          log(
            "warn",
            "Watcher subscribe failed after adding native watches; recycling to release them",
            {
              activeSubscriptions: subscriptions.size,
              watchError: message.message,
            },
          );
          killAndRespawn();
        }
        break;
      }
      case "unsubscribed": {
        const pending = pendingUnsubscribes.get(message.id);
        pendingUnsubscribes.delete(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve();
        }
        break;
      }
    }
  }

  function releasePendingUnsubscribes(): void {
    const pending = [...pendingUnsubscribes.values()];
    pendingUnsubscribes.clear();
    for (const unsubscribe of pending) {
      clearTimeout(unsubscribe.timer);
      unsubscribe.resolve();
    }
  }

  function releaseAbortListener(record: SubscriptionRecord): void {
    if (record.signal && record.abortListener) {
      record.signal.removeEventListener("abort", record.abortListener);
    }
    record.signal = null;
    record.abortListener = null;
  }

  function releaseChildRequests(source: ChildChannel): void {
    for (const record of subscriptions.values()) {
      if (record.requestSource === source) {
        record.requestSource = null;
      }
      if (record.rescanSource === source) {
        record.rescanSource = null;
      }
    }
  }

  function cancelPendingSubscribe(record: SubscriptionRecord): void {
    if (record.confirmation === null || !subscriptions.delete(record.id)) {
      return;
    }
    const confirmation = record.confirmation;
    const target = record.requestSource;
    record.confirmation = null;
    releaseAbortListener(record);
    confirmation.reject(new Error("Parcel watcher subscription was cancelled"));
    if (target !== null && target === channel) {
      target.send({ kind: "unsubscribe", id: record.id });
    }
  }

  function createSubscriptionHandle(id: string): ParcelAsyncSubscription {
    return {
      unsubscribe() {
        const target = channel;
        const record = subscriptions.get(id);
        if (!record || !subscriptions.delete(id)) {
          return Promise.resolve();
        }
        releaseAbortListener(record);
        if (target === null || record.requestSource !== target) {
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (!pendingUnsubscribes.delete(id)) {
              return;
            }
            resolve();
            log("warn", "Watcher child unsubscribe timed out; recycling", {
              unsubscribeTimeoutMs,
            });
            killAndRespawn();
          }, unsubscribeTimeoutMs);
          timer.unref?.();
          pendingUnsubscribes.set(id, { resolve, timer });
          target.send({ kind: "unsubscribe", id });
        });
      },
    };
  }

  function subscribe(
    dir: string,
    callback: SubscribeCallback,
    opts?: ParcelWatcherSubscribeOptions,
    signal?: AbortSignal,
  ): Promise<ParcelAsyncSubscription> {
    if (disposed) {
      return Promise.reject(new Error("Parcel watcher proxy is disposed"));
    }
    if (signal?.aborted) {
      return Promise.reject(
        new Error("Parcel watcher subscription was cancelled"),
      );
    }
    const id = nextId();
    return new Promise<ParcelAsyncSubscription>((resolve, reject) => {
      const record: SubscriptionRecord = {
        id,
        dir,
        opts,
        callback,
        confirmation: { resolve, reject },
        requestSource: null,
        rescanSource: null,
        signal: signal ?? null,
        abortListener: null,
      };
      if (signal) {
        record.abortListener = () => cancelPendingSubscribe(record);
        signal.addEventListener("abort", record.abortListener, { once: true });
      }
      subscriptions.set(id, record);
      if (channel !== null && childReady) {
        sendSubscribe(channel, record, recoveryPending);
      } else if (channel === null && respawnTimer === null) {
        startChild();
      }
    });
  }

  function dispose(): void {
    disposed = true;
    stopPing();
    if (respawnTimer !== null) {
      clearTimeout(respawnTimer);
      respawnTimer = null;
    }
    for (const record of subscriptions.values()) {
      releaseAbortListener(record);
      record.confirmation?.reject(
        new Error("Parcel watcher proxy is disposed"),
      );
    }
    subscriptions.clear();
    releasePendingUnsubscribes();
    if (channel !== null) {
      const dying = channel;
      channel = null;
      dying.kill();
    }
  }

  return { subscribe, dispose };
}
