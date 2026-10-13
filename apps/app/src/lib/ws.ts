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
import { buildBrowserWebSocketUrl } from "./dev-websocket-url";
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
      disconnectedAt: number;
    };
type ConnectedCallback = (event: WebSocketConnectedEvent) => void;
type ConnectionStateCallback = () => void;
type ResumedCallback = () => void;
export type WebSocketConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

export const REALTIME_PING_INTERVAL_MS = 25_000;
export const REALTIME_PONG_TIMEOUT_MS = 5_000;
export const REALTIME_RESUME_PONG_TIMEOUT_MS = 1_500;
export const REALTIME_RESUME_HIDDEN_THRESHOLD_MS = 5_000;
export const REALTIME_MIN_RECONNECTION_DELAY_MS = 250;
export const REALTIME_RECONNECTION_DELAY_JITTER_MS = 250;

export interface WebSocketManagerBrowserEvents {
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
  private pendingOpenFileByThreadId = new Map<string, ThreadOpenFile>();
  private connectedCallbacks = new Set<ConnectedCallback>();
  private connectionStateCallbacks = new Set<ConnectionStateCallback>();
  private resumedCallbacks = new Set<ResumedCallback>();
  private hasConnected = false;
  private connectionState: WebSocketConnectionState = "connecting";
  private readonly browserEvents: WebSocketManagerBrowserEvents;
  private unsubscribeBrowserEvents: (() => void) | null = null;
  private lastServerActivityAt = 0;
  private disconnectedAt: number | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private pongDeadline = 0;
  private hiddenAt: number | null = null;
  private readonly minReconnectionDelay =
    REALTIME_MIN_RECONNECTION_DELAY_MS +
    Math.random() * REALTIME_RECONNECTION_DELAY_JITTER_MS;

  constructor(browserEvents?: WebSocketManagerBrowserEvents) {
    this.browserEvents = browserEvents ?? createDefaultBrowserEvents();
  }

  connect(): void {
    if (this.socket) return;

    const url = buildBrowserWebSocketUrl("/ws");

    const socket = new ReconnectingWebSocket(url, undefined, {
      minReconnectionDelay: this.minReconnectionDelay,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 2,
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
        this.replaceSocket(this.lastServerActivityAt);
        return;
      }
      this.markSocketLost(Date.now());
    };

    this.installBrowserEvents();
  }

  reconnectNow(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
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
    if (!this.browserEvents.isDocumentVisible()) {
      this.hiddenAt ??= Date.now();
    }
    const unsubscribeVisibility = this.browserEvents.subscribeToVisibility(
      () => {
        this.handleVisibilityChange();
      },
    );
    const unsubscribeOnline = this.browserEvents.subscribeToOnline(() => {
      this.handleOnline();
    });
    this.unsubscribeBrowserEvents = () => {
      unsubscribeVisibility();
      unsubscribeOnline();
    };
  }

  private handleVisibilityChange(): void {
    if (!this.browserEvents.isDocumentVisible()) {
      this.hiddenAt ??= Date.now();
      this.stopPingLoop();
      return;
    }
    const hiddenAt = this.hiddenAt;
    this.hiddenAt = null;
    if (
      hiddenAt !== null &&
      Date.now() - hiddenAt >= REALTIME_RESUME_HIDDEN_THRESHOLD_MS
    ) {
      this.notifyResumed();
    }
    this.probeOrReconnect();
    this.startPingLoop();
  }

  private handleOnline(): void {
    if (!this.browserEvents.isDocumentVisible()) {
      return;
    }
    this.notifyResumed();
    this.probeOrReconnect();
  }

  private notifyResumed(): void {
    if (!this.socket) {
      return;
    }
    for (const callback of this.resumedCallbacks) {
      callback();
    }
  }

  private probeOrReconnect(): void {
    if (!this.socket || !this.browserEvents.isDocumentVisible()) {
      return;
    }
    switch (this.socket.readyState) {
      case WebSocket.OPEN:
        this.sendPing({
          ignoreRecentActivity: true,
          timeoutMs: REALTIME_RESUME_PONG_TIMEOUT_MS,
        });
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
      this.sendPing({
        ignoreRecentActivity: false,
        timeoutMs: REALTIME_PONG_TIMEOUT_MS,
      });
    }, REALTIME_PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
  }

  private sendPing({
    ignoreRecentActivity,
    timeoutMs,
  }: {
    ignoreRecentActivity: boolean;
    timeoutMs: number;
  }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const now = Date.now();
    if (
      !ignoreRecentActivity &&
      now - this.lastServerActivityAt < REALTIME_PONG_TIMEOUT_MS
    ) {
      return;
    }
    this.sendMessage({ type: "ping" });
    const deadline = now + timeoutMs;
    if (this.pongTimer !== null) {
      if (this.pongDeadline <= deadline) {
        return;
      }
      clearTimeout(this.pongTimer);
    }
    this.pongDeadline = deadline;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.reconnectNow();
    }, timeoutMs);
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private noteServerActivity(): void {
    this.lastServerActivityAt = Date.now();
  }

  private markSocketLost(at: number): void {
    this.stopPingLoop();
    if (this.hasConnected && this.disconnectedAt === null) {
      this.disconnectedAt = at;
    }
    this.setConnectionState(this.hasConnected ? "reconnecting" : "connecting");
  }

  handleIncomingMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (pongMessageLenientSchema.safeParse(parsed).success) {
      this.clearPongTimer();
      return;
    }

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

    const pluginSignal = pluginSignalLenientSchema.safeParse(parsed);
    if (pluginSignal.success) {
      for (const cb of this.pluginSignalCallbacks) {
        cb(pluginSignal.data);
      }
      return;
    }

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
    this.hiddenAt = null;
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

  onResumed(callback: ResumedCallback): () => void {
    this.resumedCallbacks.add(callback);
    return () => {
      this.resumedCallbacks.delete(callback);
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
