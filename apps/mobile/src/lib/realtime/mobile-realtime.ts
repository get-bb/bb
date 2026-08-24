import {
  changedMessageLenientSchema,
  pluginSignalLenientSchema,
  pongMessageLenientSchema,
  realtimeSubscriptionTargetKey,
  threadOpenSignalLenientSchema,
  threadPaneActionSignalLenientSchema,
  type ChangedMessage,
  type ClientMessage,
  type PluginSignal,
  type RealtimeSubscriptionTarget,
  type ThreadOpenFile,
  type ThreadOpenSignal,
  type ThreadPaneActionSignal,
} from "@bb/server-contract";
import {
  SOCKET_OPEN,
  defaultRealtimeSocketFactory,
  type RealtimeSocketFactory,
  type RealtimeSocketLike,
} from "./socket";

export type MobileRealtimeConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * A connection attempt ended before the socket opened (refused upgrade,
 * unreachable host, handshake timeout). `authRejected` is set when the
 * platform's error message names an auth status — React Native reports
 * "Received bad response code from server 401" (iOS) / "Expected HTTP 101
 * response but was '401 Unauthorized'" (Android) for a gate that refused
 * the session cookie — so the owner can re-check the session right away
 * instead of backing off.
 */
export interface MobileRealtimeConnectFailedEvent {
  message: string | null;
  authRejected: boolean;
}

const AUTH_REJECTION_PATTERN = /\b40[13]\b|unauthorized|forbidden/iu;

function isAuthRejectionMessage(message: string | null): boolean {
  return message !== null && AUTH_REJECTION_PATTERN.test(message);
}

export type MobileRealtimeConnectedEvent =
  | { reconnected: false }
  | {
      /** The socket had connected before (reconnect, resume, or a probe). */
      reconnected: true;
      /**
       * Watermark for reconnect catch-up: the last moment the previous socket
       * was known to be healthy (the last inbound frame for a socket that
       * failed a liveness probe, the close/suspend time otherwise). Data
       * fetched after it may still be current; data fetched before it may
       * have missed change events.
       */
      disconnectedAt: number;
    };

/**
 * `WebSocketManager`-shaped realtime client for React Native (see
 * apps/app/src/lib/ws.ts for the web twin). One instance per server profile.
 *
 * Differences from the web manager: explicit `suspend()`/`resume()` for
 * AppState (the socket is closed in the background but subscriptions are
 * kept and replayed on resume), an injectable socket factory, and no
 * partysocket dependency (backoff is implemented here: 1s × 1.5 → 30s).
 *
 * Liveness: React Native's WebSocket exposes no ping/pong either, and a
 * half-open socket (Wi-Fi to LTE switch, a tunnel hiccup) stays `OPEN` while
 * delivering nothing. While connected the manager sends an app-level `ping`
 * on an interval, treats any inbound frame as proof of life, and replaces a
 * socket whose probe goes unanswered. `resume()` on an already-open socket
 * (iOS `inactive` → `active`) probes it right away.
 */
export interface MobileRealtime {
  connect(): void;
  disconnect(): void;
  /** App went to the background: close the socket, keep subscriptions. */
  suspend(): void;
  /**
   * App is active again: reconnect (if `connect()` was called) and replay
   * subscriptions. When the socket was never suspended (a transient
   * `inactive`), an open socket is probed and a closed one reconnects now.
   */
  resume(): void;
  /**
   * Something that may have fixed the connection just happened (a fresh
   * session cookie): a closed socket waiting out its backoff reconnects
   * now, an open one is probed, an attempt in flight is left alone.
   */
  probeOrReconnect(): void;
  subscribe(target: RealtimeSubscriptionTarget): void;
  unsubscribe(target: RealtimeSubscriptionTarget): void;
  onChanged(callback: (message: ChangedMessage) => void): () => void;
  onThreadOpen(callback: (signal: ThreadOpenSignal) => void): () => void;
  onThreadPaneAction(
    callback: (signal: ThreadPaneActionSignal) => void,
  ): () => void;
  onPluginSignal(callback: (signal: PluginSignal) => void): () => void;
  onConnected(
    callback: (event: MobileRealtimeConnectedEvent) => void,
  ): () => void;
  /** A connection attempt failed before opening (see the event type). */
  onConnectFailed(
    callback: (event: MobileRealtimeConnectFailedEvent) => void,
  ): () => void;
  onConnectionStateChange(callback: () => void): () => void;
  getConnectionState(): MobileRealtimeConnectionState;
  isSuspended(): boolean;
  consumePendingOpenFile(threadId: string): ThreadOpenFile | null;
  dispose(): void;
}

export interface CreateMobileRealtimeOptions {
  /** Absolute `ws(s)://…/ws` URL (see `realtimeUrlForServer`). */
  url: string;
  socketFactory?: RealtimeSocketFactory;
  /** Extra upgrade headers, evaluated per connection attempt (cookie hook). */
  headers?: () => Record<string, string>;
  connectionTimeoutMs?: number;
  onInvalidMessage?: (error: unknown) => void;
}

const REALTIME_MIN_RECONNECT_DELAY_MS = 1000;
const REALTIME_MAX_RECONNECT_DELAY_MS = 30_000;
const REALTIME_RECONNECT_GROW_FACTOR = 1.5;
const REALTIME_CONNECTION_TIMEOUT_MS = 10_000;
/** Same cadence as the web manager (apps/app/src/lib/ws.ts). */
export const REALTIME_PING_INTERVAL_MS = 25_000;
export const REALTIME_PONG_TIMEOUT_MS = 5_000;

interface ActiveSubscription {
  count: number;
  target: RealtimeSubscriptionTarget;
}

export function reconnectDelayMs(
  attempt: number,
  options: {
    minDelayMs: number;
    maxDelayMs: number;
    growFactor: number;
  },
): number {
  return Math.min(
    options.maxDelayMs,
    Math.round(options.minDelayMs * options.growFactor ** attempt),
  );
}

export function createMobileRealtime(
  options: CreateMobileRealtimeOptions,
): MobileRealtime {
  const socketFactory = options.socketFactory ?? defaultRealtimeSocketFactory;
  const backoff = {
    minDelayMs: REALTIME_MIN_RECONNECT_DELAY_MS,
    maxDelayMs: REALTIME_MAX_RECONNECT_DELAY_MS,
    growFactor: REALTIME_RECONNECT_GROW_FACTOR,
  };
  const connectionTimeoutMs =
    options.connectionTimeoutMs ?? REALTIME_CONNECTION_TIMEOUT_MS;
  const onInvalidMessage =
    options.onInvalidMessage ??
    ((error: unknown) => {
      console.warn("Ignored invalid realtime message", error);
    });

  const subscriptions = new Map<string, ActiveSubscription>();
  const changedCallbacks = new Set<(message: ChangedMessage) => void>();
  const threadOpenCallbacks = new Set<(signal: ThreadOpenSignal) => void>();
  const paneActionCallbacks = new Set<
    (signal: ThreadPaneActionSignal) => void
  >();
  const pluginSignalCallbacks = new Set<(signal: PluginSignal) => void>();
  const connectedCallbacks = new Set<
    (event: MobileRealtimeConnectedEvent) => void
  >();
  const connectFailedCallbacks = new Set<
    (event: MobileRealtimeConnectFailedEvent) => void
  >();
  const connectionStateCallbacks = new Set<() => void>();
  const pendingOpenFileByThreadId = new Map<string, ThreadOpenFile>();

  let socket: RealtimeSocketLike | null = null;
  /** Whether the current socket ever opened, and its last error message. */
  let socketOpened = false;
  let socketErrorMessage: string | null = null;
  let started = false;
  let suspended = false;
  let disposed = false;
  let hasConnected = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last moment the current socket proved it was alive (open or any frame). */
  let lastServerActivityAt = 0;
  /** Set when a connected socket is lost; consumed by the next onopen. */
  let disconnectedAt: number | null = null;
  let connectionState: MobileRealtimeConnectionState = "connecting";

  function setConnectionState(next: MobileRealtimeConnectionState): void {
    if (connectionState === next) return;
    connectionState = next;
    for (const callback of connectionStateCallbacks) callback();
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearConnectionTimer(): void {
    if (connectionTimer !== null) {
      clearTimeout(connectionTimer);
      connectionTimer = null;
    }
  }

  function send(message: ClientMessage): void {
    if (socket && socket.readyState === SOCKET_OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function clearPongTimer(): void {
    if (pongTimer !== null) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  }

  function stopPingLoop(): void {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    clearPongTimer();
  }

  function sendPing(): void {
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    // A frame that just arrived is proof enough; do not add traffic to a
    // socket that is visibly alive (a streaming turn delivers many per second).
    if (Date.now() - lastServerActivityAt < REALTIME_PONG_TIMEOUT_MS) return;
    send({ type: "ping" });
    // A probe already outstanding keeps its own timer.
    if (pongTimer !== null) return;
    pongTimer = setTimeout(() => {
      pongTimer = null;
      reconnectNow();
    }, REALTIME_PONG_TIMEOUT_MS);
  }

  function startPingLoop(): void {
    if (pingTimer !== null) return;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    pingTimer = setInterval(sendPing, REALTIME_PING_INTERVAL_MS);
  }

  /** Any inbound frame proves the socket is alive, not only a pong. */
  function noteServerActivity(): void {
    lastServerActivityAt = Date.now();
    clearPongTimer();
  }

  /** The connected socket is gone; remember when it was last trusted. */
  function markSocketLost(at: number): void {
    stopPingLoop();
    if (hasConnected && disconnectedAt === null) {
      disconnectedAt = at;
    }
    setConnectionState(hasConnected ? "reconnecting" : "connecting");
  }

  /** Detach and close the current socket without triggering reconnect logic. */
  function teardownSocket(): void {
    clearConnectionTimer();
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    try {
      current.close(1000, "client closing");
    } catch {
      // Closing an already-closed socket is not an error we care about.
    }
  }

  function scheduleReconnect(): void {
    if (disposed || suspended || !started) return;
    clearReconnectTimer();
    const delay = reconnectDelayMs(reconnectAttempt, backoff);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function emitConnectFailed(message: string | null): void {
    const event: MobileRealtimeConnectFailedEvent = {
      message,
      authRejected: isAuthRejectionMessage(message),
    };
    for (const callback of connectFailedCallbacks) callback(event);
  }

  function handleSocketClosed(closed: RealtimeSocketLike): void {
    if (closed !== socket) return;
    clearConnectionTimer();
    socket = null;
    if (disposed) return;
    if (!socketOpened) {
      const message = socketErrorMessage;
      socketErrorMessage = null;
      markSocketLost(Date.now());
      emitConnectFailed(message);
      scheduleReconnect();
      return;
    }
    if (pongTimer !== null) {
      // The close confirms what the unanswered probe suspected: the socket
      // was already dead when the ping went out. Reconnect right away instead
      // of waiting out the first backoff, and watermark from the last inbound
      // frame.
      markSocketLost(lastServerActivityAt);
      openSocket();
      return;
    }
    markSocketLost(Date.now());
    scheduleReconnect();
  }

  function reconnectNow(): void {
    if (disposed || suspended || !started) return;
    const current = socket;
    if (current) {
      // A live-looking socket that failed its probe: watermark from the last
      // inbound frame, not "now" — anything fetched after it may have raced a
      // dead connection. A socket still connecting was never trusted.
      const watermark =
        current.readyState === SOCKET_OPEN ? lastServerActivityAt : Date.now();
      teardownSocket();
      markSocketLost(watermark);
    }
    clearReconnectTimer();
    openSocket();
  }

  /**
   * The app came to the foreground without a suspend in between (iOS
   * `inactive`): an open socket is probed, a closed one waiting out its
   * backoff reconnects now, an attempt in flight is left alone.
   */
  function probeOrReconnect(): void {
    if (disposed || suspended || !started) return;
    if (!socket) {
      if (reconnectTimer !== null) reconnectNow();
      return;
    }
    if (socket.readyState === SOCKET_OPEN) sendPing();
  }

  function openSocket(): void {
    if (socket || disposed || suspended || !started) return;
    clearReconnectTimer();
    const next = socketFactory(options.url, {
      headers: options.headers?.() ?? {},
    });
    socket = next;
    socketOpened = false;
    socketErrorMessage = null;
    connectionTimer = setTimeout(() => {
      connectionTimer = null;
      if (socket !== next) return;
      // Handshake stalled: drop it and back off like a failed attempt.
      teardownSocket();
      setConnectionState(hasConnected ? "reconnecting" : "connecting");
      emitConnectFailed("handshake timeout");
      scheduleReconnect();
    }, connectionTimeoutMs);

    next.onopen = () => {
      if (socket !== next) return;
      socketOpened = true;
      clearConnectionTimer();
      reconnectAttempt = 0;
      const previousDisconnectedAt = disconnectedAt;
      disconnectedAt = null;
      lastServerActivityAt = Date.now();
      const reconnected = hasConnected;
      hasConnected = true;
      setConnectionState("connected");
      startPingLoop();
      for (const subscription of subscriptions.values()) {
        send({ type: "subscribe", target: subscription.target });
      }
      const event: MobileRealtimeConnectedEvent = reconnected
        ? {
            reconnected,
            disconnectedAt: previousDisconnectedAt ?? Date.now(),
          }
        : { reconnected };
      for (const callback of connectedCallbacks) callback(event);
    };
    next.onmessage = (event) => {
      if (socket !== next) return;
      if (typeof event.data !== "string") return;
      noteServerActivity();
      handleIncomingMessage(event.data);
    };
    next.onclose = (event) => {
      // React Native emits `error` then `close` for a failed connection; the
      // close handler owns reconnect scheduling. React Native puts the
      // platform's failure reason ("Received bad response code from server:
      // 401.") in the close event's `reason` (RN ≥ 0.86; older versions and
      // some platforms set `message` on the error event), so either is kept
      // for the failure report.
      if (socket === next && !socketOpened && socketErrorMessage === null) {
        socketErrorMessage = event.reason.length > 0 ? event.reason : null;
      }
      handleSocketClosed(next);
    };
    next.onerror = (event) => {
      if (socket !== next) return;
      if (event.message !== null) socketErrorMessage = event.message;
    };
  }

  function handleIncomingMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    // Answer to our liveness probe; receipt already cleared the pong timer.
    if (pongMessageLenientSchema.safeParse(parsed).success) return;

    const threadOpen = threadOpenSignalLenientSchema.safeParse(parsed);
    if (threadOpen.success) {
      if (threadOpen.data.file !== null) {
        pendingOpenFileByThreadId.set(
          threadOpen.data.threadId,
          threadOpen.data.file,
        );
      }
      for (const callback of threadOpenCallbacks) callback(threadOpen.data);
      return;
    }

    const paneAction = threadPaneActionSignalLenientSchema.safeParse(parsed);
    if (paneAction.success) {
      for (const callback of paneActionCallbacks) callback(paneAction.data);
      return;
    }

    const pluginSignal = pluginSignalLenientSchema.safeParse(parsed);
    if (pluginSignal.success) {
      for (const callback of pluginSignalCallbacks) callback(pluginSignal.data);
      return;
    }

    const changed = changedMessageLenientSchema.safeParse(parsed);
    if (changed.success) {
      for (const callback of changedCallbacks) callback(changed.data);
      return;
    }
    onInvalidMessage(changed.error);
  }

  function listen<T>(set: Set<T>, callback: T): () => void {
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  }

  return {
    connect() {
      if (disposed) return;
      started = true;
      if (suspended) return;
      openSocket();
    },
    disconnect() {
      started = false;
      clearReconnectTimer();
      stopPingLoop();
      const hadSocket = socket !== null;
      teardownSocket();
      reconnectAttempt = 0;
      if (hadSocket && hasConnected && disconnectedAt === null) {
        disconnectedAt = Date.now();
      }
      setConnectionState("connecting");
    },
    suspend() {
      if (suspended) return;
      suspended = true;
      clearReconnectTimer();
      teardownSocket();
      reconnectAttempt = 0;
      if (started) {
        // The socket is closed on purpose; anything fetched before now is
        // the last data this client can trust.
        markSocketLost(Date.now());
      } else {
        stopPingLoop();
      }
    },
    resume() {
      if (!suspended) {
        probeOrReconnect();
        return;
      }
      suspended = false;
      if (!started || disposed) return;
      openSocket();
    },
    probeOrReconnect,
    subscribe(target) {
      const key = realtimeSubscriptionTargetKey(target);
      const existing = subscriptions.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      subscriptions.set(key, { count: 1, target });
      send({ type: "subscribe", target });
    },
    unsubscribe(target) {
      const key = realtimeSubscriptionTargetKey(target);
      const existing = subscriptions.get(key);
      if (!existing) return;
      if (existing.count > 1) {
        existing.count -= 1;
        return;
      }
      subscriptions.delete(key);
      send({ type: "unsubscribe", target });
    },
    onChanged: (callback) => listen(changedCallbacks, callback),
    onThreadOpen: (callback) => listen(threadOpenCallbacks, callback),
    onThreadPaneAction: (callback) => listen(paneActionCallbacks, callback),
    onPluginSignal: (callback) => listen(pluginSignalCallbacks, callback),
    onConnected: (callback) => listen(connectedCallbacks, callback),
    onConnectFailed: (callback) => listen(connectFailedCallbacks, callback),
    onConnectionStateChange: (callback) =>
      listen(connectionStateCallbacks, callback),
    getConnectionState: () => connectionState,
    isSuspended: () => suspended,
    consumePendingOpenFile(threadId) {
      const pending = pendingOpenFileByThreadId.get(threadId);
      if (!pending) return null;
      pendingOpenFileByThreadId.delete(threadId);
      return pending;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      clearReconnectTimer();
      stopPingLoop();
      teardownSocket();
      changedCallbacks.clear();
      threadOpenCallbacks.clear();
      paneActionCallbacks.clear();
      pluginSignalCallbacks.clear();
      connectFailedCallbacks.clear();
      connectedCallbacks.clear();
      connectionStateCallbacks.clear();
      subscriptions.clear();
      pendingOpenFileByThreadId.clear();
    },
  };
}
