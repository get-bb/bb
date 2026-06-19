import type {
  ChangedMessage,
  ClientMessage,
  RealtimeSubscriptionTarget,
} from "@bb/domain";
import { realtimeSubscriptionTargetKey } from "@bb/domain";
import {
  serverMessageLenientSchema,
  type ServerMessage,
} from "@bb/server-contract";
import { resolveRealtimeUrl } from "./realtime-url.js";
import type {
  BbRealtime,
  BbRealtimeCallback,
  BbRealtimeConnectionEvent,
  BbRealtimeEventMap,
  BbRealtimeEventName,
  BbRealtimeOnArgs,
  BbRealtimeOnArgsUnion,
  BbRealtimeUnsubscribe,
  SystemRealtimeEvent,
} from "./realtime-types.js";
import type {
  BbRealtimeSocket,
  BbRealtimeSocketFactory,
  BbRealtimeSocketMessageEvent,
  BbSdkTransport,
} from "./transport.js";

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_DELAY_MULTIPLIER = 1.5;

interface CreateBbRealtimeClientArgs {
  transport: BbSdkTransport;
}

interface TargetSubscription {
  count: number;
  target: RealtimeSubscriptionTarget;
}

interface OptionalTargetIdMatchesArgs {
  messageId: string | undefined;
  selectorId: string | undefined;
}

type IdScopedChangedEventName =
  | "thread:changed"
  | "project:changed"
  | "environment:changed"
  | "host:changed";

type UnscopedChangedEventName = "system:changed" | "system:config-changed";

/**
 * Listener for an entity-changed event that may be scoped to one entity id:
 * a set `selectorId` delivers only messages carrying that id.
 */
interface IdScopedChangedListenerRecord<
  TEventName extends IdScopedChangedEventName,
> {
  active: boolean;
  callback: BbRealtimeCallback<TEventName>;
  event: TEventName;
  selectorId?: string;
  target: RealtimeSubscriptionTarget;
}

interface UnscopedChangedListenerRecord<
  TEventName extends UnscopedChangedEventName,
> {
  active: boolean;
  callback: BbRealtimeCallback<TEventName>;
  event: TEventName;
  target: RealtimeSubscriptionTarget;
}

type ChangedListenerRecord =
  | {
      [TEventName in IdScopedChangedEventName]: IdScopedChangedListenerRecord<TEventName>;
    }[IdScopedChangedEventName]
  | {
      [TEventName in UnscopedChangedEventName]: UnscopedChangedListenerRecord<TEventName>;
    }[UnscopedChangedEventName];

interface ConnectionListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"realtime:connection">;
  event: "realtime:connection";
}

type RealtimeListenerRecord =
  | ChangedListenerRecord
  | ConnectionListenerRecord;

function targetKey(target: RealtimeSubscriptionTarget): string {
  return realtimeSubscriptionTargetKey(target);
}

function threadRealtimeTarget(
  threadId: string | undefined,
): RealtimeSubscriptionTarget {
  return threadId
    ? { kind: "thread-detail", threadId }
    : { kind: "thread-list" };
}

function projectRealtimeTarget(
  projectId: string | undefined,
): RealtimeSubscriptionTarget {
  return projectId
    ? { kind: "project-detail", projectId }
    : { kind: "project-list" };
}

function environmentRealtimeTarget(
  environmentId: string | undefined,
): RealtimeSubscriptionTarget {
  return environmentId
    ? { kind: "environment-detail", environmentId }
    : { kind: "environment-list" };
}

function hostRealtimeTarget(
  hostId: string | undefined,
): RealtimeSubscriptionTarget {
  return hostId
    ? { kind: "host-detail", hostId }
    : { kind: "host-list" };
}

function optionalTargetIdMatches(args: OptionalTargetIdMatchesArgs): boolean {
  return args.selectorId === undefined || args.messageId === args.selectorId;
}

/**
 * Adapts a standard (browser/Node-global) WebSocket to the runtime-agnostic
 * socket shape the realtime client consumes.
 */
export function wrapStandardWebsocket(socket: WebSocket): BbRealtimeSocket {
  const adapter: BbRealtimeSocket = {
    close: () => socket.close(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
  };
  socket.onopen = () => adapter.onopen?.();
  socket.onmessage = (event) => adapter.onmessage?.({ data: event.data });
  socket.onclose = () => adapter.onclose?.();
  socket.onerror = () => adapter.onerror?.();
  return adapter;
}

function resolveDefaultWebsocketFactory(): BbRealtimeSocketFactory | null {
  if (typeof WebSocket === "undefined") {
    return null;
  }
  return (url) => wrapStandardWebsocket(new WebSocket(url));
}

function isTargetedListener(
  listener: RealtimeListenerRecord,
): listener is Exclude<RealtimeListenerRecord, ConnectionListenerRecord> {
  return listener.event !== "realtime:connection";
}

/**
 * The union parameter is a TypeScript workaround: a predicate against the
 * plain listener union cannot assert the generic record (the generic
 * instantiation is not assignable to any single union member), but narrowing
 * still resolves to exactly `IdScopedChangedListenerRecord<TEventName>`, which
 * keeps the callback/message pairing type-safe in the shared dispatch loop.
 */
function isIdScopedChangedListenerFor<
  TEventName extends IdScopedChangedEventName,
>(
  listener: RealtimeListenerRecord | IdScopedChangedListenerRecord<TEventName>,
  event: TEventName,
): listener is IdScopedChangedListenerRecord<TEventName> {
  return listener.event === event;
}

export class BbRealtimeClient implements BbRealtime {
  private readonly listeners = new Set<RealtimeListenerRecord>();
  private readonly targetSubscriptions = new Map<string, TargetSubscription>();
  private readonly transport: BbSdkTransport;
  private lastConnectionEvent: BbRealtimeConnectionEvent | null = null;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private reconnectingAfterUnexpectedClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rejectSocketReady: ((error: Error) => void) | null = null;
  private resolveSocketReady: (() => void) | null = null;
  private socket: BbRealtimeSocket | null = null;
  private socketReadyPromise: Promise<void> | null = null;

  constructor(args: CreateBbRealtimeClientArgs) {
    this.transport = args.transport;
  }

  on<TEventName extends BbRealtimeEventName>(
    args: BbRealtimeOnArgs<TEventName>,
  ): BbRealtimeUnsubscribe {
    return this.addListener(args);
  }

  private addListener(args: BbRealtimeOnArgsUnion): BbRealtimeUnsubscribe {
    switch (args.event) {
      case "thread:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          selectorId: args.threadId,
          target: threadRealtimeTarget(args.threadId),
        });
      case "project:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          selectorId: args.projectId,
          target: projectRealtimeTarget(args.projectId),
        });
      case "environment:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          selectorId: args.environmentId,
          target: environmentRealtimeTarget(args.environmentId),
        });
      case "host:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          selectorId: args.hostId,
          target: hostRealtimeTarget(args.hostId),
        });
      case "system:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          target: { kind: "system" },
        });
      case "system:config-changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          target: { kind: "system" },
        });
      case "realtime:connection":
        return this.addConnectionListener({
          active: true,
          callback: args.callback,
          event: args.event,
        });
    }
  }

  private addChangedListener(
    listener: ChangedListenerRecord,
  ): BbRealtimeUnsubscribe {
    return this.activateListener(listener);
  }

  private addConnectionListener(
    listener: ConnectionListenerRecord,
  ): BbRealtimeUnsubscribe {
    const unsubscribe = this.activateListener(listener);
    const snapshot = this.lastConnectionEvent;
    if (snapshot) {
      // Late observers get the current state; skip the snapshot if a live
      // transition already superseded it (the listener saw that one instead).
      queueMicrotask(() => {
        if (listener.active && this.lastConnectionEvent === snapshot) {
          this.callListener(listener.callback, snapshot);
        }
      });
    }
    return unsubscribe;
  }

  private activateListener(
    listener: RealtimeListenerRecord,
  ): BbRealtimeUnsubscribe {
    this.listeners.add(listener);
    if (isTargetedListener(listener)) {
      this.addTarget(listener.target);
      try {
        void this.connectSocket().catch((error) => {
          if (listener.active) {
            console.error("bb realtime connection failed", error);
          }
        });
      } catch (error) {
        this.removeListener(listener);
        throw error;
      }
    }

    return () => this.removeListener(listener);
  }

  private removeListener(listener: RealtimeListenerRecord): void {
    if (!listener.active) {
      return;
    }
    listener.active = false;
    this.listeners.delete(listener);
    if (isTargetedListener(listener)) {
      this.removeTarget(listener.target);
    }
    this.closeSocketIfIdle();
  }

  private addTarget(target: RealtimeSubscriptionTarget): void {
    const key = targetKey(target);
    const existing = this.targetSubscriptions.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.targetSubscriptions.set(key, { count: 1, target });
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.sendTargetMessage("subscribe", target);
    }
  }

  private removeTarget(target: RealtimeSubscriptionTarget): void {
    const key = targetKey(target);
    const existing = this.targetSubscriptions.get(key);
    if (!existing) {
      return;
    }
    if (existing.count > 1) {
      existing.count -= 1;
      return;
    }
    this.targetSubscriptions.delete(key);
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.sendTargetMessage("unsubscribe", target);
    }
  }

  private connectSocket(): Promise<void> {
    if (this.targetSubscriptions.size === 0) {
      return Promise.resolve();
    }
    if (
      this.socket &&
      (this.socket.readyState === SOCKET_OPEN ||
        this.socket.readyState === SOCKET_CONNECTING)
    ) {
      return this.ensureSocketReadyPromise();
    }

    // Anything that can throw synchronously (factory resolution, URL
    // derivation, socket construction) must happen BEFORE the socket-ready
    // promise is created — a throw after creation would orphan a pending
    // promise that no caller holds, turning cleanup's rejection into an
    // unhandled rejection.
    const websocketFactory =
      this.transport.websocket ?? resolveDefaultWebsocketFactory();
    if (!websocketFactory) {
      throw new Error(
        "BB SDK realtime requires a WebSocket implementation. Pass websocket when creating the transport.",
      );
    }
    const socket = websocketFactory(
      resolveRealtimeUrl({ transport: this.transport }),
    );

    // This connect supersedes any scheduled backoff retry; an orphaned timer
    // would re-connect needlessly and escalate the delay while connected.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.resetSocketReadyPromise();
    const socketReadyPromise = this.ensureSocketReadyPromise();
    const reconnected = this.reconnectingAfterUnexpectedClose;
    this.socket = socket;
    this.emitConnection({
      state: "connecting",
      reconnected,
      reconnectDelayMs: null,
    });

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      const openedAfterReconnect = this.reconnectingAfterUnexpectedClose;
      this.reconnectingAfterUnexpectedClose = false;
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      for (const subscription of this.targetSubscriptions.values()) {
        this.sendTargetMessage("subscribe", subscription.target);
      }
      this.resolveSocketReadyPromise();
      this.closeSocketIfIdle();
      if (this.socket !== socket) {
        return;
      }
      if (openedAfterReconnect) {
        this.emitConnection({
          state: "connected",
          reconnected: true,
          reconnectDelayMs: null,
        });
        return;
      }
      this.emitConnection({
        state: "connected",
        reconnected: false,
        reconnectDelayMs: null,
      });
    };

    socket.onmessage = (event) => {
      this.handleSocketMessage(event);
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.clearSocketReadyPromise(
        new Error("bb realtime socket closed before it became ready."),
      );
      if (this.targetSubscriptions.size === 0) {
        // A socket that was already CLOSING when the last listener
        // unsubscribed skips closeSocketIfIdle's teardown emit (it only
        // handles OPEN/CONNECTING), so its close completes here: announce the
        // terminal disconnect so observers never stay on a stale state.
        if (this.lastConnectionEvent?.state !== "disconnected") {
          this.emitConnection({
            state: "disconnected",
            reconnected: false,
            reconnectDelayMs: null,
          });
        }
        return;
      }
      // Always record the reconnect intent and announce the drop, even if a
      // stale retry timer is pending — otherwise the next open would skip
      // the reconnect replay and observers would never see the disconnect.
      this.reconnectingAfterUnexpectedClose = true;
      const reconnectDelayMs = this.reconnectDelayMs;
      this.emitConnection({
        state: "disconnected",
        reconnected: false,
        reconnectDelayMs,
      });
      // A connection listener may react to the disconnected emit by adding a
      // listener, which connects a new socket before this timer would be
      // scheduled. That connect supersedes the retry: scheduling it anyway
      // would let the orphaned timer escalate reconnectDelayMs while already
      // connected.
      if (this.reconnectTimer || this.socket) {
        return;
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnectDelayMs = Math.min(
          reconnectDelayMs * RECONNECT_DELAY_MULTIPLIER,
          MAX_RECONNECT_DELAY_MS,
        );
        // connectSocket can throw synchronously (e.g. a misconfigured
        // transport); inside a timer callback nothing above us catches, so
        // contain it here to keep the process alive.
        try {
          void this.connectSocket().catch((error) => {
            console.error("bb realtime reconnect failed", error);
          });
        } catch (error) {
          console.error("bb realtime reconnect failed", error);
        }
      }, reconnectDelayMs);
    };

    socket.onerror = () => {
      socket.close();
    };

    return socketReadyPromise;
  }

  private closeSocketIfIdle(): void {
    if (this.targetSubscriptions.size > 0) {
      return;
    }
    let canceledPendingReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      canceledPendingReconnect = true;
    }
    this.reconnectingAfterUnexpectedClose = false;
    this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    this.clearSocketReadyPromise(
      new Error(
        "bb realtime socket closed because there are no active targets.",
      ),
    );
    if (
      this.socket &&
      (this.socket.readyState === SOCKET_OPEN ||
        this.socket.readyState === SOCKET_CONNECTING)
    ) {
      const socket = this.socket;
      this.socket = null;
      this.emitConnection({
        state: "disconnected",
        reconnected: false,
        reconnectDelayMs: null,
      });
      socket.close();
      return;
    }
    if (canceledPendingReconnect) {
      // The last disconnected event promised a retry in N ms; tell observers
      // that retry was canceled so they don't wait for it forever.
      this.emitConnection({
        state: "disconnected",
        reconnected: false,
        reconnectDelayMs: null,
      });
    }
  }

  private handleSocketMessage(event: BbRealtimeSocketMessageEvent): void {
    if (typeof event.data !== "string") {
      return;
    }
    let parsedMessage: unknown;
    try {
      parsedMessage = JSON.parse(event.data);
    } catch (error) {
      console.error("bb realtime ignored malformed websocket message", error);
      return;
    }

    // Silently skip message types this client does not consume (e.g. the
    // app-only "thread-open-file" panel signal the server broadcasts to every
    // socket). Like the lenient inbound parsing, tolerate a newer server
    // adding message types instead of logging each one as an error.
    if (
      typeof parsedMessage === "object" &&
      parsedMessage !== null &&
      "type" in parsedMessage &&
      typeof (parsedMessage as { type: unknown }).type === "string" &&
      (parsedMessage as { type: string }).type !== "changed"
    ) {
      return;
    }

    const parseResult = serverMessageLenientSchema.safeParse(parsedMessage);
    if (!parseResult.success) {
      console.error(
        "bb realtime ignored invalid websocket message",
        parseResult.error,
      );
      return;
    }
    this.dispatchMessage(parseResult.data);
  }

  private dispatchMessage(message: ServerMessage): void {
    this.dispatchChangedMessage(message);
  }

  private dispatchChangedMessage(message: ChangedMessage): void {
    switch (message.entity) {
      case "thread":
        this.dispatchIdScopedChangedMessage("thread:changed", message);
        break;
      case "project":
        this.dispatchIdScopedChangedMessage("project:changed", message);
        break;
      case "environment":
        this.dispatchIdScopedChangedMessage("environment:changed", message);
        break;
      case "host":
        this.dispatchIdScopedChangedMessage("host:changed", message);
        break;
      case "system":
        this.dispatchSystemChangedMessage(message);
        break;
    }
  }

  private dispatchIdScopedChangedMessage<
    TEventName extends IdScopedChangedEventName,
  >(event: TEventName, message: BbRealtimeEventMap[TEventName]): void {
    for (const listener of this.listenerSnapshot()) {
      if (
        !isIdScopedChangedListenerFor(listener, event) ||
        !listener.active ||
        !optionalTargetIdMatches({
          messageId: message.id,
          selectorId: listener.selectorId,
        })
      ) {
        continue;
      }
      this.callListener(listener.callback, message);
    }
  }

  private dispatchSystemChangedMessage(message: SystemRealtimeEvent): void {
    for (const listener of this.listenerSnapshot()) {
      if (!listener.active) {
        continue;
      }
      if (listener.event === "system:changed") {
        this.callListener(listener.callback, message);
      }
      if (
        listener.event === "system:config-changed" &&
        message.changes.includes("config-changed")
      ) {
        this.callListener(listener.callback, message);
      }
    }
  }

  private ensureSocketReadyPromise(): Promise<void> {
    if (!this.socketReadyPromise) {
      this.resetSocketReadyPromise();
    }
    if (!this.socketReadyPromise) {
      throw new Error("BB SDK realtime socket readiness was not initialized.");
    }
    return this.socketReadyPromise;
  }

  private resetSocketReadyPromise(): void {
    this.clearSocketReadyPromise(
      new Error("bb realtime socket closed before it became ready."),
    );
    this.socketReadyPromise = new Promise((resolve, reject) => {
      this.resolveSocketReady = resolve;
      this.rejectSocketReady = reject;
    });
  }

  private resolveSocketReadyPromise(): void {
    if (!this.resolveSocketReady) {
      return;
    }
    this.resolveSocketReady();
    this.resolveSocketReady = null;
    this.rejectSocketReady = null;
  }

  private clearSocketReadyPromise(error: Error): void {
    this.rejectSocketReadyPromise(error);
    this.socketReadyPromise = null;
  }

  private rejectSocketReadyPromise(error: Error): void {
    if (!this.rejectSocketReady) {
      return;
    }
    this.rejectSocketReady(error);
    this.resolveSocketReady = null;
    this.rejectSocketReady = null;
  }

  private sendTargetMessage(
    type: "subscribe" | "unsubscribe",
    target: RealtimeSubscriptionTarget,
  ): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    const message: ClientMessage = { type, target };
    this.socket.send(JSON.stringify(message));
  }

  private emitConnection(event: BbRealtimeConnectionEvent): void {
    this.lastConnectionEvent = event;
    for (const listener of this.listenerSnapshot()) {
      if (listener.event !== "realtime:connection" || !listener.active) {
        continue;
      }
      this.callListener(listener.callback, event);
    }
  }

  /**
   * Dispatch iterates a snapshot: a listener registered from inside a
   * callback must not receive the in-flight event.
   */
  private listenerSnapshot(): RealtimeListenerRecord[] {
    return [...this.listeners];
  }

  private callListener<TEventName extends BbRealtimeEventName>(
    callback: BbRealtimeCallback<TEventName>,
    event: Parameters<BbRealtimeCallback<TEventName>>[0],
  ): void {
    try {
      callback(event);
    } catch (error) {
      console.error("bb realtime listener failed", error);
    }
  }
}

export function createBbRealtimeClient(
  args: CreateBbRealtimeClientArgs,
): BbRealtimeClient {
  return new BbRealtimeClient(args);
}
