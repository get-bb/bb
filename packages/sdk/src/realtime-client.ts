import {
  appDataPathSchema,
  applicationIdSchema,
  type AppDataPath,
  type ApplicationId,
  type ChangedMessage,
  type ClientMessage,
  type RealtimeEntity,
} from "@bb/domain";
import {
  serverMessageLenientSchema,
  type ServerMessage,
} from "@bb/server-contract";
import { requireCurrentApplicationId } from "./areas/common.js";
import { cloneJsonValue } from "./json-clone.js";
import { resolveRealtimeUrl } from "./realtime-url.js";
import type {
  BbRealtime,
  BbRealtimeCallback,
  BbRealtimeConnectionEvent,
  BbRealtimeEventName,
  BbRealtimeListAppDataEntries,
  BbRealtimeOnArgs,
  BbRealtimeOnArgsUnion,
  BbRealtimeUnsubscribe,
  AppDataChangedRealtimeEvent,
  AppRealtimeEvent,
  EnvironmentRealtimeEvent,
  HostRealtimeEvent,
  ProjectRealtimeEvent,
  SystemRealtimeEvent,
  ThreadRealtimeEvent,
} from "./realtime-types.js";
import type {
  BbRealtimeSocket,
  BbRealtimeSocketFactory,
  BbRealtimeSocketMessageEvent,
  BbSdkContext,
  BbSdkTransport,
} from "./transport.js";

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_DELAY_MULTIPLIER = 1.5;

interface CreateBbRealtimeClientArgs {
  context: BbSdkContext;
  listAppDataEntries: BbRealtimeListAppDataEntries;
  transport: BbSdkTransport;
}

interface RealtimeTarget {
  entity: RealtimeEntity;
  id?: string;
}

interface TargetSubscription extends RealtimeTarget {
  count: number;
}

interface PathMatchesPrefixArgs {
  path: AppDataPath;
  prefix: AppDataPath | "";
}

interface OptionalTargetIdMatchesArgs {
  messageId: string | undefined;
  selectorId: string | undefined;
}

interface ThreadChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"thread:changed">;
  event: "thread:changed";
  selectorId?: string;
  target: RealtimeTarget;
}

interface ProjectChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"project:changed">;
  event: "project:changed";
  selectorId?: string;
  target: RealtimeTarget;
}

interface EnvironmentChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"environment:changed">;
  event: "environment:changed";
  selectorId?: string;
  target: RealtimeTarget;
}

interface HostChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"host:changed">;
  event: "host:changed";
  selectorId?: string;
  target: RealtimeTarget;
}

interface SystemChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"system:changed">;
  event: "system:changed";
  target: RealtimeTarget;
}

interface SystemConfigChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"system:config-changed">;
  event: "system:config-changed";
  target: RealtimeTarget;
}

interface SystemAppsChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"system:apps-changed">;
  event: "system:apps-changed";
  target: RealtimeTarget;
}

interface AppChangedListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"app:changed">;
  event: "app:changed";
  target: RealtimeTarget;
}

type ChangedListenerRecord =
  | ThreadChangedListenerRecord
  | ProjectChangedListenerRecord
  | EnvironmentChangedListenerRecord
  | HostChangedListenerRecord
  | SystemChangedListenerRecord
  | SystemConfigChangedListenerRecord
  | SystemAppsChangedListenerRecord
  | AppChangedListenerRecord;

interface AppDataChangedListenerRecord {
  active: boolean;
  applicationId: ApplicationId;
  bufferedEvents: AppDataChangedRealtimeEvent[];
  callback: BbRealtimeCallback<"app-data:changed">;
  event: "app-data:changed";
  prefix: AppDataPath | "";
  replaying: boolean;
  replayPromise: Promise<void> | null;
  target: RealtimeTarget;
}

interface AppDataResyncListenerRecord {
  active: boolean;
  applicationId: ApplicationId;
  callback: BbRealtimeCallback<"app-data:resync">;
  event: "app-data:resync";
  target: RealtimeTarget;
}

interface ConnectionListenerRecord {
  active: boolean;
  callback: BbRealtimeCallback<"realtime:connection">;
  event: "realtime:connection";
}

type RealtimeListenerRecord =
  | ChangedListenerRecord
  | AppDataChangedListenerRecord
  | AppDataResyncListenerRecord
  | ConnectionListenerRecord;

function targetKey(target: RealtimeTarget): string {
  return target.id ? `${target.entity}:${target.id}` : target.entity;
}

function appDataTarget(applicationId: ApplicationId): RealtimeTarget {
  return {
    entity: "app",
    id: `${applicationId}:data`,
  };
}

function realtimeTarget(
  entity: RealtimeEntity,
  id: string | undefined,
): RealtimeTarget {
  return id ? { entity, id } : { entity };
}

function pathMatchesPrefix(args: PathMatchesPrefixArgs): boolean {
  return (
    args.prefix === "" ||
    args.path === args.prefix ||
    args.path.startsWith(`${args.prefix}/`)
  );
}

function prefixPath(input: AppDataPath | "" | undefined): AppDataPath | "" {
  const value = input ?? "";
  if (value === "") {
    return "";
  }
  return appDataPathSchema.parse(value);
}

function cloneAppDataChangedEvent(
  event: AppDataChangedRealtimeEvent,
): AppDataChangedRealtimeEvent {
  return { ...event, value: cloneJsonValue(event.value) };
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

export class BbRealtimeClient implements BbRealtime {
  private readonly context: BbSdkContext;
  private readonly listAppDataEntries: BbRealtimeListAppDataEntries;
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
    this.context = args.context;
    this.listAppDataEntries = args.listAppDataEntries;
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
          target: realtimeTarget("thread", args.threadId),
        });
      case "project:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          selectorId: args.projectId,
          target: realtimeTarget("project", args.projectId),
        });
      case "environment:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          selectorId: args.environmentId,
          target: realtimeTarget("environment", args.environmentId),
        });
      case "host:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          selectorId: args.hostId,
          target: realtimeTarget("host", args.hostId),
        });
      case "system:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          target: { entity: "system" },
        });
      case "system:config-changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          target: { entity: "system" },
        });
      case "system:apps-changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          target: { entity: "system" },
        });
      case "app:changed":
        return this.addChangedListener({
          active: true,
          callback: args.callback,
          event: args.event,
          target: { entity: "app" },
        });
      case "app-data:changed":
        return this.addAppDataChangedListener(args);
      case "app-data:resync":
        return this.addAppDataResyncListener(args);
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

  private addAppDataChangedListener(
    args: Extract<BbRealtimeOnArgsUnion, { event: "app-data:changed" }>,
  ): BbRealtimeUnsubscribe {
    const applicationId = this.resolveApplicationId(args.applicationId);
    const listener: AppDataChangedListenerRecord = {
      active: true,
      applicationId,
      bufferedEvents: [],
      callback: args.callback,
      event: args.event,
      prefix: prefixPath(args.prefix),
      replaying: false,
      replayPromise: null,
      target: appDataTarget(applicationId),
    };
    const unsubscribe = this.activateListener(listener);
    void this.replayExistingAppData(listener);
    return unsubscribe;
  }

  private addAppDataResyncListener(
    args: Extract<BbRealtimeOnArgsUnion, { event: "app-data:resync" }>,
  ): BbRealtimeUnsubscribe {
    const applicationId = this.resolveApplicationId(args.applicationId);
    return this.activateListener({
      active: true,
      applicationId,
      callback: args.callback,
      event: args.event,
      target: appDataTarget(applicationId),
    });
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
    if (listener.event === "app-data:changed") {
      listener.bufferedEvents = [];
    }
    this.listeners.delete(listener);
    if (isTargetedListener(listener)) {
      this.removeTarget(listener.target);
    }
    this.closeSocketIfIdle();
  }

  private addTarget(target: RealtimeTarget): void {
    const key = targetKey(target);
    const existing = this.targetSubscriptions.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.targetSubscriptions.set(key, { ...target, count: 1 });
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.sendTargetMessage("subscribe", target);
    }
  }

  private removeTarget(target: RealtimeTarget): void {
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
      for (const target of this.targetSubscriptions.values()) {
        this.sendTargetMessage("subscribe", target);
      }
      this.resolveSocketReadyPromise();
      this.closeSocketIfIdle();
      if (this.socket !== socket) {
        return;
      }
      if (openedAfterReconnect) {
        // Broadcasts may have been missed while disconnected: tell resync
        // subscribers to re-read, then self-heal app-data:changed listeners
        // via replay before announcing the reconnect.
        this.notifyAppDataResyncListeners();
        void this.replayActiveAppDataListeners()
          .catch((error) => {
            console.error("bb realtime reconnect replay failed", error);
          })
          .then(() => {
            if (this.socket !== socket) {
              return;
            }
            this.emitConnection({
              state: "connected",
              reconnected: true,
              reconnectDelayMs: null,
            });
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
      if (this.reconnectTimer) {
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
    switch (message.type) {
      case "changed":
        this.dispatchChangedMessage(message);
        break;
      case "app-data.changed":
        this.dispatchAppDataChangedMessage(message);
        break;
      case "app-data.resync":
        this.dispatchAppDataResyncMessage(message);
        break;
    }
  }

  private dispatchChangedMessage(message: ChangedMessage): void {
    switch (message.entity) {
      case "thread":
        this.dispatchThreadChangedMessage(message);
        break;
      case "project":
        this.dispatchProjectChangedMessage(message);
        break;
      case "environment":
        this.dispatchEnvironmentChangedMessage(message);
        break;
      case "host":
        this.dispatchHostChangedMessage(message);
        break;
      case "system":
        this.dispatchSystemChangedMessage(message);
        break;
      case "app":
        this.dispatchAppChangedMessage(message);
        break;
    }
  }

  private dispatchThreadChangedMessage(message: ThreadRealtimeEvent): void {
    for (const listener of this.listenerSnapshot()) {
      if (
        listener.event !== "thread:changed" ||
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

  private dispatchProjectChangedMessage(message: ProjectRealtimeEvent): void {
    for (const listener of this.listenerSnapshot()) {
      if (
        listener.event !== "project:changed" ||
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

  private dispatchEnvironmentChangedMessage(
    message: EnvironmentRealtimeEvent,
  ): void {
    for (const listener of this.listenerSnapshot()) {
      if (
        listener.event !== "environment:changed" ||
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

  private dispatchHostChangedMessage(message: HostRealtimeEvent): void {
    for (const listener of this.listenerSnapshot()) {
      if (
        listener.event !== "host:changed" ||
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
      if (
        listener.event === "system:apps-changed" &&
        message.changes.includes("apps-changed")
      ) {
        this.callListener(listener.callback, message);
      }
    }
  }

  private dispatchAppChangedMessage(message: AppRealtimeEvent): void {
    for (const listener of this.listenerSnapshot()) {
      if (listener.event !== "app:changed" || !listener.active) {
        continue;
      }
      this.callListener(listener.callback, message);
    }
  }

  private dispatchAppDataChangedMessage(
    message: AppDataChangedRealtimeEvent,
  ): void {
    for (const listener of this.listenerSnapshot()) {
      if (
        listener.event !== "app-data:changed" ||
        !listener.active ||
        listener.applicationId !== message.applicationId ||
        !pathMatchesPrefix({ path: message.path, prefix: listener.prefix })
      ) {
        continue;
      }
      if (listener.replaying) {
        listener.bufferedEvents.push(cloneAppDataChangedEvent(message));
        continue;
      }
      this.callListener(listener.callback, cloneAppDataChangedEvent(message));
    }
  }

  private dispatchAppDataResyncMessage(
    message: Extract<ServerMessage, { type: "app-data.resync" }>,
  ): void {
    for (const listener of this.listenerSnapshot()) {
      if (!listener.active) {
        continue;
      }
      if (
        listener.event === "app-data:resync" &&
        listener.applicationId === message.applicationId
      ) {
        this.callListener(listener.callback, message);
      }
      if (
        listener.event === "app-data:changed" &&
        listener.applicationId === message.applicationId
      ) {
        void this.replayExistingAppData(listener);
      }
    }
  }

  private notifyAppDataResyncListeners(): void {
    for (const listener of this.listenerSnapshot()) {
      if (listener.event !== "app-data:resync" || !listener.active) {
        continue;
      }
      this.callListener(listener.callback, {
        type: "app-data.resync",
        applicationId: listener.applicationId,
      });
    }
  }

  private async replayActiveAppDataListeners(): Promise<void> {
    const replayPromises: Promise<void>[] = [];
    for (const listener of this.listenerSnapshot()) {
      if (listener.event === "app-data:changed" && listener.active) {
        replayPromises.push(this.replayExistingAppData(listener));
      }
    }
    await Promise.all(replayPromises);
  }

  private replayExistingAppData(
    listener: AppDataChangedListenerRecord,
  ): Promise<void> {
    if (!listener.active) {
      return Promise.resolve();
    }
    listener.replayPromise = (listener.replayPromise ?? Promise.resolve())
      .then(async () => {
        if (!listener.active) {
          return;
        }
        listener.replaying = true;
        listener.bufferedEvents = [];
        await this.connectSocket();
        if (!listener.active) {
          return;
        }
        const entries = await this.listAppDataEntries({
          applicationId: listener.applicationId,
          prefix: listener.prefix,
        });
        const replayedVersions = new Map<string, string>();
        for (const entry of entries) {
          if (!listener.active) {
            return;
          }
          replayedVersions.set(entry.path, entry.version);
          this.callListener(listener.callback, {
            type: "app-data.changed",
            applicationId: listener.applicationId,
            path: entry.path,
            value: cloneJsonValue(entry.value),
            deleted: false,
            version: entry.version,
          });
        }
        // Per-path flush rule: when the replay snapshot already delivered the
        // FINAL buffered state of a path, skip all of that path's buffered
        // events — delivering any of them would resurface an older value
        // after the newest one. Versions are content hashes (not orderable),
        // so dedupe can only key off the last buffered event per path.
        const lastBufferedVersionByPath = new Map<string, string | null>();
        for (const event of listener.bufferedEvents) {
          lastBufferedVersionByPath.set(
            event.path,
            event.deleted ? null : event.version,
          );
        }
        for (const event of listener.bufferedEvents) {
          if (!listener.active) {
            return;
          }
          const lastVersion = lastBufferedVersionByPath.get(event.path);
          if (
            typeof lastVersion === "string" &&
            replayedVersions.get(event.path) === lastVersion
          ) {
            continue;
          }
          this.callListener(listener.callback, cloneAppDataChangedEvent(event));
        }
      })
      .finally(() => {
        listener.replaying = false;
        listener.bufferedEvents = [];
      })
      .catch((error) => {
        if (!listener.active) {
          return;
        }
        console.error("bb realtime app-data replay failed", error);
      });
    return listener.replayPromise;
  }

  private resolveApplicationId(
    input: ApplicationId | undefined,
  ): ApplicationId {
    return applicationIdSchema.parse(
      input ?? requireCurrentApplicationId(this.context),
    );
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
    target: RealtimeTarget,
  ): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    const message: ClientMessage = target.id
      ? { type, entity: target.entity, id: target.id }
      : { type, entity: target.entity };
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
   * callback must not receive the in-flight event (for app-data listeners
   * that would deliver a live event before their replay snapshot).
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
