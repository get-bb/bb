import ReconnectingWebSocket from "partysocket/ws";
import {
  browserAutomationCancelMessageLenientSchema,
  browserAutomationCloseMessageLenientSchema,
  browserAutomationCommandMessageLenientSchema,
  browserAutomationOpenMessageLenientSchema,
  changedMessageLenientSchema,
  pluginSignalLenientSchema,
  pongMessageLenientSchema,
  realtimeSubscriptionTargetKey,
  threadOpenSignalLenientSchema,
  threadPaneActionSignalLenientSchema,
} from "@bb/server-contract";
import type {
  BrowserAutomationCapabilityMessage,
  BrowserAutomationCancelMessage,
  BrowserAutomationCancelRequestMessage,
  BrowserAutomationCloseMessage,
  BrowserAutomationCommandFailedMessage,
  BrowserAutomationCommandMessage,
  BrowserAutomationCommandResultMessage,
  BrowserAutomationOpenFailedMessage,
  BrowserAutomationOpenMessage,
  BrowserAutomationOpenReadyMessage,
  BrowserAutomationTargetClosedMessage,
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
type BrowserAutomationOpenCallback = (
  message: BrowserAutomationOpenMessage,
) => void;
type BrowserAutomationCloseCallback = (
  message: BrowserAutomationCloseMessage,
) => void;
type BrowserAutomationCommandCallback = (
  message: BrowserAutomationCommandMessage,
) => void;
type BrowserAutomationCancelCallback = (
  message: BrowserAutomationCancelMessage,
) => void;
export type BrowserAutomationClientReply =
  | BrowserAutomationOpenReadyMessage
  | BrowserAutomationOpenFailedMessage
  | BrowserAutomationTargetClosedMessage
  | BrowserAutomationCommandResultMessage
  | BrowserAutomationCommandFailedMessage
  | BrowserAutomationCancelRequestMessage;
export type WebSocketConnectedEvent =
  | { reconnected: false }
  | {
      reconnected: true;
      disconnectedAt: number;
    };
type ConnectedCallback = (event: WebSocketConnectedEvent) => void;
type DisconnectedCallback = () => void;
type ConnectionStateCallback = () => void;
export type WebSocketConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

export const REALTIME_PING_INTERVAL_MS = 25_000;
export const REALTIME_PONG_TIMEOUT_MS = 5_000;

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
  private browserAutomationOpenCallbacks =
    new Set<BrowserAutomationOpenCallback>();
  private browserAutomationCloseCallbacks =
    new Set<BrowserAutomationCloseCallback>();
  private browserAutomationCommandCallbacks =
    new Set<BrowserAutomationCommandCallback>();
  private browserAutomationCancelCallbacks =
    new Set<BrowserAutomationCancelCallback>();
  private browserAutomationCapability: BrowserAutomationCapabilityMessage | null =
    null;
  private pendingOpenFileByThreadId = new Map<string, ThreadOpenFile>();
  private connectedCallbacks = new Set<ConnectedCallback>();
  private disconnectedCallbacks = new Set<DisconnectedCallback>();
  private connectionStateCallbacks = new Set<ConnectionStateCallback>();
  private hasConnected = false;
  private connectionState: WebSocketConnectionState = "connecting";
  private readonly browserEvents: WebSocketManagerBrowserEvents;
  private unsubscribeBrowserEvents: (() => void) | null = null;
  private lastServerActivityAt = 0;
  private disconnectedAt: number | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(browserEvents?: WebSocketManagerBrowserEvents) {
    this.browserEvents = browserEvents ?? createDefaultBrowserEvents();
  }

  connect(): void {
    if (this.socket) return;

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
      for (const subscription of this.subscriptions.values()) {
        this.sendMessage({ type: "subscribe", target: subscription.target });
      }
      if (this.browserAutomationCapability !== null) {
        this.sendMessage(this.browserAutomationCapability);
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
    if (Date.now() - this.lastServerActivityAt < REALTIME_PONG_TIMEOUT_MS) {
      return;
    }
    this.sendMessage({ type: "ping" });
    if (this.pongTimer !== null) {
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

  private noteServerActivity(): void {
    this.lastServerActivityAt = Date.now();
    this.clearPongTimer();
  }

  private markSocketLost(at: number): void {
    this.stopPingLoop();
    const newlyDisconnected = this.hasConnected && this.disconnectedAt === null;
    if (newlyDisconnected) {
      this.disconnectedAt = at;
      for (const callback of this.disconnectedCallbacks) callback();
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

    const browserAutomationOpen =
      browserAutomationOpenMessageLenientSchema.safeParse(parsed);
    if (browserAutomationOpen.success) {
      for (const cb of this.browserAutomationOpenCallbacks) {
        cb(browserAutomationOpen.data);
      }
      return;
    }

    const browserAutomationClose =
      browserAutomationCloseMessageLenientSchema.safeParse(parsed);
    if (browserAutomationClose.success) {
      for (const cb of this.browserAutomationCloseCallbacks) {
        cb(browserAutomationClose.data);
      }
      return;
    }

    const browserAutomationCommand =
      browserAutomationCommandMessageLenientSchema.safeParse(parsed);
    if (browserAutomationCommand.success) {
      for (const cb of this.browserAutomationCommandCallbacks) {
        cb(browserAutomationCommand.data);
      }
      return;
    }

    const browserAutomationCancel =
      browserAutomationCancelMessageLenientSchema.safeParse(parsed);
    if (browserAutomationCancel.success) {
      for (const cb of this.browserAutomationCancelCallbacks) {
        cb(browserAutomationCancel.data);
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
    this.markSocketLost(Date.now());
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

  onBrowserAutomationOpen(callback: BrowserAutomationOpenCallback): () => void {
    this.browserAutomationOpenCallbacks.add(callback);
    return () => {
      this.browserAutomationOpenCallbacks.delete(callback);
    };
  }

  onBrowserAutomationClose(
    callback: BrowserAutomationCloseCallback,
  ): () => void {
    this.browserAutomationCloseCallbacks.add(callback);
    return () => {
      this.browserAutomationCloseCallbacks.delete(callback);
    };
  }

  onBrowserAutomationCommand(
    callback: BrowserAutomationCommandCallback,
  ): () => void {
    this.browserAutomationCommandCallbacks.add(callback);
    return () => {
      this.browserAutomationCommandCallbacks.delete(callback);
    };
  }

  onBrowserAutomationCancel(
    callback: BrowserAutomationCancelCallback,
  ): () => void {
    this.browserAutomationCancelCallbacks.add(callback);
    return () => {
      this.browserAutomationCancelCallbacks.delete(callback);
    };
  }

  setBrowserAutomationCapability(windowId: string): void {
    this.browserAutomationCapability = {
      type: "browser-automation.capability",
      windowId,
    };
    this.sendMessage(this.browserAutomationCapability);
  }

  clearBrowserAutomationCapability(): void {
    if (this.browserAutomationCapability === null) {
      return;
    }
    this.browserAutomationCapability = null;
    this.sendMessage({ type: "browser-automation.capability-unavailable" });
  }

  sendBrowserAutomationReply(message: BrowserAutomationClientReply): void {
    this.sendMessage(message);
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

  onDisconnected(callback: DisconnectedCallback): () => void {
    this.disconnectedCallbacks.add(callback);
    return () => {
      this.disconnectedCallbacks.delete(callback);
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
