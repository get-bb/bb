import ReconnectingWebSocket from "partysocket/ws";
import {
  changedMessageLenientSchema,
  pluginSignalLenientSchema,
  pongMessageLenientSchema,
  realtimeSubscriptionTargetKey,
  threadOpenSignalLenientSchema,
  threadPaneActionSignalLenientSchema,
} from "@bb/server-contract";
import type {
  ClientMessage,
  ChangedMessage,
  PluginSignal,
  RealtimeSubscriptionTarget,
  ThreadOpenFile,
  ThreadOpenSignal,
  ThreadPaneActionSignal,
} from "@bb/server-contract";
import { buildDevWebSocketUrl } from "./dev-websocket-url";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "./document-visibility";

type ChangeCallback = (message: ChangedMessage) => void;
type ThreadOpenCallback = (signal: ThreadOpenSignal) => void;
type ThreadPaneActionCallback = (signal: ThreadPaneActionSignal) => void;
type PluginSignalCallback = (signal: PluginSignal) => void;
export type WebSocketConnectedEvent =
  | { reconnected: false }
  | {
      reconnected: true;
      /**
       * Watermark for reconnect catch-up: the last moment the previous socket
       * was known to be healthy. Data fetched after it may still be current;
       * data fetched before it may have missed change events.
       */
      disconnectedAt: number;
    };
type ConnectedCallback = (event: WebSocketConnectedEvent) => void;
type ConnectionStateCallback = () => void;
export type WebSocketConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * Browser-visible liveness for the realtime socket. Browsers expose no
 * WebSocket-level ping, and a half-open socket (Wi-Fi to LTE switch, iOS
 * background suspend, tunnel hiccup) stays `OPEN` forever while delivering
 * nothing — the app would sit on stale data with a green connection badge.
 * While the document is visible the manager sends an app-level `ping` on an
 * interval and treats any inbound frame as proof of life; a probe with no
 * answer within the timeout forces a reconnect. Hidden documents send nothing
 * (iOS suspends timers anyway) and probe once on the next visible/online.
 */
export const REALTIME_PING_INTERVAL_MS = 25_000;
export const REALTIME_PONG_TIMEOUT_MS = 5_000;

export interface WebSocketManagerBrowserEvents {
  /** Fires on visibilitychange, pageshow and window focus. */
  subscribeToVisibility: (listener: () => void) => () => void;
  isDocumentVisible: () => boolean;
  subscribeToOnline: (listener: () => void) => () => void;
}

function createDefaultBrowserEvents(): WebSocketManagerBrowserEvents {
  return {
    subscribeToVisibility: subscribeToDocumentVisibility,
    isDocumentVisible,
    subscribeToOnline: (listener) => {
      if (typeof window === "undefined") {
        return () => {};
      }
      window.addEventListener("online", listener);
      return () => {
        window.removeEventListener("online", listener);
      };
    },
  };
}

interface ActiveSubscription {
  count: number;
  target: RealtimeSubscriptionTarget;
}

export class WebSocketManager {
  private socket: ReconnectingWebSocket | null = null;
  private subscriptions = new Map<string, ActiveSubscription>();
  private callbacks = new Set<ChangeCallback>();
  private threadOpenCallbacks = new Set<ThreadOpenCallback>();
  private threadPaneActionCallbacks = new Set<ThreadPaneActionCallback>();
  private pluginSignalCallbacks = new Set<PluginSignalCallback>();
  // Ephemeral "open this file in the secondary panel" intents, keyed by thread.
  // Held in memory only (cleared on reload) so a thread that is not currently
  // viewed opens the file when it is next viewed. Last write wins per thread.
  private pendingOpenFileByThreadId = new Map<string, ThreadOpenFile>();
  private connectedCallbacks = new Set<ConnectedCallback>();
  private connectionStateCallbacks = new Set<ConnectionStateCallback>();
  private hasConnected = false;
  private connectionState: WebSocketConnectionState = "connecting";
  private readonly browserEvents: WebSocketManagerBrowserEvents;
  private unsubscribeBrowserEvents: (() => void) | null = null;
  /** Last moment the current socket proved it was alive (open or any frame). */
  private lastServerActivityAt = 0;
  /** Set when a connected socket is lost; consumed by the next onopen. */
  private disconnectedAt: number | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(browserEvents?: WebSocketManagerBrowserEvents) {
    this.browserEvents = browserEvents ?? createDefaultBrowserEvents();
  }

  connect(): void {
    if (this.socket) return;

    // In dev mode, connect directly to the server to bypass Vite's WS proxy
    // which does not handle reconnection after backend restarts.
    // In production, use the same origin (server serves the app).
    const url =
      buildDevWebSocketUrl({ path: "/ws" }) ??
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

    const socket = new ReconnectingWebSocket(url, undefined, {
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      connectionTimeout: 10000,
      maxRetries: Infinity,
    });
    this.socket = socket;

    socket.onopen = () => {
      const disconnectedAt = this.disconnectedAt;
      this.disconnectedAt = null;
      this.lastServerActivityAt = Date.now();
      const reconnected = this.hasConnected;
      this.hasConnected = true;
      this.setConnectionState("connected");
      this.startPingLoop();
      // Re-subscribe to all active subscriptions
      for (const subscription of this.subscriptions.values()) {
        this.sendMessage({ type: "subscribe", target: subscription.target });
      }
      const event: WebSocketConnectedEvent = reconnected
        ? { reconnected, disconnectedAt: disconnectedAt ?? Date.now() }
        : { reconnected };
      for (const callback of this.connectedCallbacks) {
        callback(event);
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      this.noteServerActivity();
      this.handleIncomingMessage(event.data);
    };

    socket.onclose = () => {
      if (this.pongTimer !== null) {
        // The close confirms what the unanswered probe suspected: the socket
        // was already dead when the ping went out (iOS resume typically
        // delivers visibilitychange first and the close a moment later).
        // Reconnect right away instead of waiting out partysocket's first
        // backoff, and watermark from the last inbound frame.
        this.replaceSocket(this.lastServerActivityAt);
        return;
      }
      this.markSocketLost(Date.now());
    };

    this.installBrowserEvents();
  }

  /**
   * Drop the current socket and connect again right away, skipping
   * partysocket's backoff. Used when the browser tells us the network is back
   * or the tab is visible again, and when a liveness probe gets no answer.
   */
  reconnectNow(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    // A live-looking socket that failed its probe: use the watermark from the
    // last inbound frame, not "now" — anything fetched after it may have raced
    // a dead connection. A closed socket was already watermarked by its close.
    this.replaceSocket(
      socket.readyState === WebSocket.OPEN
        ? this.lastServerActivityAt
        : Date.now(),
    );
  }

  private replaceSocket(disconnectedAt: number): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    this.markSocketLost(disconnectedAt);
    // partysocket ignores reconnect() while a backoff wait holds its connect
    // lock, so replace the instance instead of asking it to retry.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.close();
    this.socket = null;
    this.connect();
  }

  private installBrowserEvents(): void {
    if (this.unsubscribeBrowserEvents) {
      return;
    }
    const unsubscribeVisibility = this.browserEvents.subscribeToVisibility(
      () => {
        this.handleVisibilityChange();
      },
    );
    const unsubscribeOnline = this.browserEvents.subscribeToOnline(() => {
      this.probeOrReconnect();
    });
    this.unsubscribeBrowserEvents = () => {
      unsubscribeVisibility();
      unsubscribeOnline();
    };
  }

  private handleVisibilityChange(): void {
    if (!this.browserEvents.isDocumentVisible()) {
      this.stopPingLoop();
      return;
    }
    this.probeOrReconnect();
    this.startPingLoop();
  }

  /**
   * The browser signalled a change that often kills sockets silently. A
   * closed socket (waiting out partysocket's backoff) reconnects immediately;
   * an OPEN one is probed and reconnects only if the probe times out; an
   * attempt already in flight is left alone.
   */
  private probeOrReconnect(): void {
    if (!this.socket || !this.browserEvents.isDocumentVisible()) {
      return;
    }
    switch (this.socket.readyState) {
      case WebSocket.OPEN:
        this.sendPing();
        return;
      case WebSocket.CONNECTING:
        return;
      default:
        this.reconnectNow();
    }
  }

  private startPingLoop(): void {
    if (this.pingTimer !== null || !this.browserEvents.isDocumentVisible()) {
      return;
    }
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, REALTIME_PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
  }

  private sendPing(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    // A frame that just arrived is proof enough; do not add traffic to a
    // socket that is visibly alive (a streaming turn delivers many per second).
    if (Date.now() - this.lastServerActivityAt < REALTIME_PONG_TIMEOUT_MS) {
      return;
    }
    this.sendMessage({ type: "ping" });
    if (this.pongTimer !== null) {
      // A probe is already outstanding; its timer decides.
      return;
    }
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.reconnectNow();
    }, REALTIME_PONG_TIMEOUT_MS);
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /** Any inbound frame proves the socket is alive, not only a pong. */
  private noteServerActivity(): void {
    this.lastServerActivityAt = Date.now();
    this.clearPongTimer();
  }

  private markSocketLost(at: number): void {
    this.stopPingLoop();
    if (this.hasConnected && this.disconnectedAt === null) {
      this.disconnectedAt = at;
    }
    this.setConnectionState(this.hasConnected ? "reconnecting" : "connecting");
  }

  /**
   * Parse and dispatch one raw server message. Public only so tests can
   * exercise the routing without a live socket.
   */
  handleIncomingMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // Ignore malformed messages
      return;
    }

    // Answer to our liveness probe; receipt already cleared the pong timer.
    if (pongMessageLenientSchema.safeParse(parsed).success) {
      return;
    }

    // Ephemeral thread-open broadcast. Notify layout listeners immediately;
    // when it includes a file, buffer that file per thread until the target
    // pane's secondary panel is ready to consume it.
    const threadOpen = threadOpenSignalLenientSchema.safeParse(parsed);
    if (threadOpen.success) {
      if (threadOpen.data.file !== null) {
        this.pendingOpenFileByThreadId.set(
          threadOpen.data.threadId,
          threadOpen.data.file,
        );
      }
      for (const cb of this.threadOpenCallbacks) {
        cb(threadOpen.data);
      }
      return;
    }

    const threadPaneAction =
      threadPaneActionSignalLenientSchema.safeParse(parsed);
    if (threadPaneAction.success) {
      for (const cb of this.threadPaneActionCallbacks) {
        cb(threadPaneAction.data);
      }
      return;
    }

    // Ephemeral plugin realtime signal (bb.realtime.publish). Not buffered:
    // only live useRealtime subscribers care, and V1 has no replay.
    const pluginSignal = pluginSignalLenientSchema.safeParse(parsed);
    if (pluginSignal.success) {
      for (const cb of this.pluginSignalCallbacks) {
        cb(pluginSignal.data);
      }
      return;
    }

    // Lenient parse: tolerate a newer server (unknown fields stripped,
    // unknown change kinds filtered) instead of dropping whole messages
    // on additive contract changes.
    const msg = changedMessageLenientSchema.safeParse(parsed);
    if (msg.success) {
      for (const cb of this.callbacks) {
        cb(msg.data);
      }
    } else {
      console.error("Ignored invalid realtime message", msg.error);
    }
  }

  disconnect(): void {
    this.stopPingLoop();
    if (this.hasConnected && this.disconnectedAt === null) {
      this.disconnectedAt = Date.now();
    }
    if (this.unsubscribeBrowserEvents) {
      this.unsubscribeBrowserEvents();
      this.unsubscribeBrowserEvents = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setConnectionState("connecting");
  }

  subscribe(target: RealtimeSubscriptionTarget): void {
    const key = realtimeSubscriptionTargetKey(target);
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }

    this.subscriptions.set(key, { count: 1, target });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendMessage({ type: "subscribe", target });
    }
  }

  unsubscribe(target: RealtimeSubscriptionTarget): void {
    const key = realtimeSubscriptionTargetKey(target);
    const existing = this.subscriptions.get(key);
    if (!existing) {
      return;
    }
    if (existing.count > 1) {
      existing.count -= 1;
      return;
    }

    this.subscriptions.delete(key);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendMessage({ type: "unsubscribe", target });
    }
  }

  onChanged(callback: ChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  onThreadOpen(callback: ThreadOpenCallback): () => void {
    this.threadOpenCallbacks.add(callback);
    return () => {
      this.threadOpenCallbacks.delete(callback);
    };
  }

  onThreadPaneAction(callback: ThreadPaneActionCallback): () => void {
    this.threadPaneActionCallbacks.add(callback);
    return () => {
      this.threadPaneActionCallbacks.delete(callback);
    };
  }

  onPluginSignal(callback: PluginSignalCallback): () => void {
    this.pluginSignalCallbacks.add(callback);
    return () => {
      this.pluginSignalCallbacks.delete(callback);
    };
  }

  /**
   * Return and clear the buffered "open file" intent for a thread, if any. The
   * secondary panel calls this when the thread becomes visible so the file
   * opens exactly once and is not re-opened on a later visit.
   */
  consumePendingOpenFile(threadId: string): ThreadOpenFile | null {
    const pending = this.pendingOpenFileByThreadId.get(threadId);
    if (!pending) {
      return null;
    }
    this.pendingOpenFileByThreadId.delete(threadId);
    return pending;
  }

  onConnected(callback: ConnectedCallback): () => void {
    this.connectedCallbacks.add(callback);
    return () => {
      this.connectedCallbacks.delete(callback);
    };
  }

  onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.connectionStateCallbacks.add(callback);
    return () => {
      this.connectionStateCallbacks.delete(callback);
    };
  }

  getConnectionState(): WebSocketConnectionState {
    return this.connectionState;
  }

  private sendMessage(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private setConnectionState(nextState: WebSocketConnectionState): void {
    if (this.connectionState === nextState) {
      return;
    }
    this.connectionState = nextState;
    for (const callback of this.connectionStateCallbacks) {
      callback();
    }
  }
}

// Singleton instance — preserved across Vite HMR so the WebSocket connection
// and its state survive module re-evaluation during dev rebuilds.
function createOrReuse(): WebSocketManager {
  if (import.meta.hot?.data) {
    const existing = import.meta.hot.data.wsManager as
      | WebSocketManager
      | undefined;
    if (existing) return existing;
    const instance = new WebSocketManager();
    import.meta.hot.data.wsManager = instance;
    return instance;
  }
  return new WebSocketManager();
}

export const wsManager = createOrReuse();
