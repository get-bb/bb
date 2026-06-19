import ReconnectingWebSocket from "partysocket/ws";
import {
  changedMessageLenientSchema,
  realtimeSubscriptionTargetKey,
  threadOpenFileSignalLenientSchema,
} from "@bb/server-contract";
import type {
  ClientMessage,
  ChangedMessage,
  RealtimeSubscriptionTarget,
  ThreadOpenFileSignal,
} from "@bb/server-contract";
import { buildDevWebSocketUrl } from "./dev-websocket-url";

type ChangeCallback = (message: ChangedMessage) => void;
type OpenFileCallback = (signal: ThreadOpenFileSignal) => void;
type ConnectedCallback = (event: { reconnected: boolean }) => void;
type ConnectionStateCallback = () => void;
export type WebSocketConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

interface ActiveSubscription {
  count: number;
  target: RealtimeSubscriptionTarget;
}

export class WebSocketManager {
  private socket: ReconnectingWebSocket | null = null;
  private subscriptions = new Map<string, ActiveSubscription>();
  private callbacks = new Set<ChangeCallback>();
  private openFileCallbacks = new Set<OpenFileCallback>();
  // Ephemeral "open this file in the secondary panel" intents, keyed by thread.
  // Held in memory only (cleared on reload) so a thread that is not currently
  // viewed opens the file when it is next viewed. Last write wins per thread.
  private pendingOpenByThreadId = new Map<string, ThreadOpenFileSignal>();
  private connectedCallbacks = new Set<ConnectedCallback>();
  private connectionStateCallbacks = new Set<ConnectionStateCallback>();
  private hasConnected = false;
  private connectionState: WebSocketConnectionState = "connecting";

  connect(): void {
    if (this.socket) return;

    // In dev mode, connect directly to the server to bypass Vite's WS proxy
    // which does not handle reconnection after backend restarts.
    // In production, use the same origin (server serves the app).
    const url =
      buildDevWebSocketUrl({ path: "/ws" }) ??
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

    this.socket = new ReconnectingWebSocket(url, undefined, {
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      connectionTimeout: 10000,
      maxRetries: Infinity,
    });

    this.socket.onopen = () => {
      const reconnected = this.hasConnected;
      this.hasConnected = true;
      this.setConnectionState("connected");
      // Re-subscribe to all active subscriptions
      for (const subscription of this.subscriptions.values()) {
        this.sendMessage({ type: "subscribe", target: subscription.target });
      }
      for (const callback of this.connectedCallbacks) {
        callback({ reconnected });
      }
    };

    this.socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        // Ignore malformed messages
        return;
      }

      // Ephemeral "open this file in the secondary panel" broadcast. Buffer it
      // per thread so the panel can open it now (if the thread is in view) or
      // when the thread is next viewed; also notify live listeners.
      const openFile = threadOpenFileSignalLenientSchema.safeParse(parsed);
      if (openFile.success) {
        this.pendingOpenByThreadId.set(openFile.data.threadId, openFile.data);
        for (const cb of this.openFileCallbacks) {
          cb(openFile.data);
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
    };

    this.socket.onclose = () => {
      this.setConnectionState(
        this.hasConnected ? "reconnecting" : "connecting",
      );
    };
  }

  disconnect(): void {
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

  onThreadOpenFile(callback: OpenFileCallback): () => void {
    this.openFileCallbacks.add(callback);
    return () => {
      this.openFileCallbacks.delete(callback);
    };
  }

  /**
   * Return and clear the buffered "open file" intent for a thread, if any. The
   * secondary panel calls this when the thread becomes visible so the file
   * opens exactly once and is not re-opened on a later visit.
   */
  consumePendingOpen(threadId: string): ThreadOpenFileSignal | null {
    const pending = this.pendingOpenByThreadId.get(threadId);
    if (!pending) {
      return null;
    }
    this.pendingOpenByThreadId.delete(threadId);
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
