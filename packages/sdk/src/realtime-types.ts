import type {
  AppDataEntry,
  AppDataBroadcastMessage,
} from "@bb/server-contract";
import type {
  ApplicationId,
  AppDataPath,
  ChangedMessage,
} from "@bb/domain";

export type BbRealtimeUnsubscribe = () => void;

export type BbRealtimeEventName =
  | "thread:changed"
  | "project:changed"
  | "environment:changed"
  | "host:changed"
  | "system:changed"
  | "system:config-changed"
  | "system:apps-changed"
  | "app:changed"
  | "app-data:changed"
  | "app-data:resync"
  | "realtime:connection";

export type ThreadRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "thread" }
>;
export type ProjectRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "project" }
>;
export type EnvironmentRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "environment" }
>;
export type HostRealtimeEvent = Extract<ChangedMessage, { entity: "host" }>;
export type SystemRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "system" }
>;
export type AppRealtimeEvent = Extract<ChangedMessage, { entity: "app" }>;
export type AppDataChangedRealtimeEvent = Extract<
  AppDataBroadcastMessage,
  { type: "app-data.changed" }
>;
export type AppDataResyncRealtimeEvent = Extract<
  AppDataBroadcastMessage,
  { type: "app-data.resync" }
>;

export type BbRealtimeConnectionState =
  | "connecting"
  | "connected"
  | "disconnected";

export interface BbRealtimeConnectionEvent {
  reconnectDelayMs: number | null;
  reconnected: boolean;
  state: BbRealtimeConnectionState;
}

/**
 * Entity-changed events are delivered as one shared object to every matching
 * listener; their payload types are readonly so a listener cannot mutate what
 * the next listener receives. app-data:changed events are defensively cloned
 * per delivery because their values are arbitrary JSON.
 */
export interface BbRealtimeEventMap {
  "thread:changed": ThreadRealtimeEvent;
  "project:changed": ProjectRealtimeEvent;
  "environment:changed": EnvironmentRealtimeEvent;
  "host:changed": HostRealtimeEvent;
  "system:changed": SystemRealtimeEvent;
  "system:config-changed": SystemRealtimeEvent;
  "system:apps-changed": SystemRealtimeEvent;
  "app:changed": AppRealtimeEvent;
  "app-data:changed": AppDataChangedRealtimeEvent;
  "app-data:resync": AppDataResyncRealtimeEvent;
  "realtime:connection": BbRealtimeConnectionEvent;
}

export type BbRealtimeCallback<TEventName extends BbRealtimeEventName> = (
  event: BbRealtimeEventMap[TEventName],
) => void;

export interface ThreadRealtimeOnArgs {
  callback: BbRealtimeCallback<"thread:changed">;
  event: "thread:changed";
  threadId?: string;
}

export interface ProjectRealtimeOnArgs {
  callback: BbRealtimeCallback<"project:changed">;
  event: "project:changed";
  projectId?: string;
}

export interface EnvironmentRealtimeOnArgs {
  callback: BbRealtimeCallback<"environment:changed">;
  environmentId?: string;
  event: "environment:changed";
}

export interface HostRealtimeOnArgs {
  callback: BbRealtimeCallback<"host:changed">;
  event: "host:changed";
  hostId?: string;
}

export interface SystemRealtimeOnArgs {
  callback: BbRealtimeCallback<"system:changed">;
  event: "system:changed";
}

export interface SystemConfigRealtimeOnArgs {
  callback: BbRealtimeCallback<"system:config-changed">;
  event: "system:config-changed";
}

export interface SystemAppsRealtimeOnArgs {
  callback: BbRealtimeCallback<"system:apps-changed">;
  event: "system:apps-changed";
}

/**
 * app:changed delivers every app-entity broadcast. `apps-changed` is the
 * global app-list signal (install/update/remove of any app), broadcast
 * alongside system:apps-changed with no per-app identity. `content-changed`
 * is app-scoped — its event carries the application id and means that app's
 * served `public/` files changed on disk.
 */
export interface AppRealtimeOnArgs {
  callback: BbRealtimeCallback<"app:changed">;
  event: "app:changed";
}

export interface AppDataChangedRealtimeOnArgs {
  applicationId?: ApplicationId;
  callback: BbRealtimeCallback<"app-data:changed">;
  event: "app-data:changed";
  prefix?: AppDataPath | "";
}

/**
 * Fires when app-data broadcasts may have been missed and state should be
 * re-read: on a server-initiated resync and after the SDK reconnects its
 * websocket (before the reconnected realtime:connection event).
 */
export interface AppDataResyncRealtimeOnArgs {
  applicationId?: ApplicationId;
  callback: BbRealtimeCallback<"app-data:resync">;
  event: "app-data:resync";
}

/**
 * Connection listeners are pure observers — they never open or hold the
 * socket. A listener registered while a socket already exists receives the
 * latest connection event as a snapshot on the next microtask, so a status
 * UI mounted after connect still learns the current state.
 */
export interface RealtimeConnectionOnArgs {
  callback: BbRealtimeCallback<"realtime:connection">;
  event: "realtime:connection";
}

export type BbRealtimeOnArgsUnion =
  | ThreadRealtimeOnArgs
  | ProjectRealtimeOnArgs
  | EnvironmentRealtimeOnArgs
  | HostRealtimeOnArgs
  | SystemRealtimeOnArgs
  | SystemConfigRealtimeOnArgs
  | SystemAppsRealtimeOnArgs
  | AppRealtimeOnArgs
  | AppDataChangedRealtimeOnArgs
  | AppDataResyncRealtimeOnArgs
  | RealtimeConnectionOnArgs;

export type BbRealtimeOnArgs<
  TEventName extends BbRealtimeEventName = BbRealtimeEventName,
> = Extract<BbRealtimeOnArgsUnion, { event: TEventName }>;

export interface BbRealtime {
  on<TEventName extends BbRealtimeEventName>(
    args: BbRealtimeOnArgs<TEventName>,
  ): BbRealtimeUnsubscribe;
}

export interface BbRealtimeListAppDataEntriesArgs {
  applicationId: ApplicationId;
  prefix?: AppDataPath | "";
}

export type BbRealtimeListAppDataEntries = (
  args: BbRealtimeListAppDataEntriesArgs,
) => Promise<AppDataEntry[]>;
