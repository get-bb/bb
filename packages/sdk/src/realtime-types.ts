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

export interface ThreadRealtimeOnInput {
  callback: BbRealtimeCallback<"thread:changed">;
  event: "thread:changed";
  threadId?: string;
}

export interface ProjectRealtimeOnInput {
  callback: BbRealtimeCallback<"project:changed">;
  event: "project:changed";
  projectId?: string;
}

export interface EnvironmentRealtimeOnInput {
  callback: BbRealtimeCallback<"environment:changed">;
  environmentId?: string;
  event: "environment:changed";
}

export interface HostRealtimeOnInput {
  callback: BbRealtimeCallback<"host:changed">;
  event: "host:changed";
  hostId?: string;
}

export interface SystemRealtimeOnInput {
  callback: BbRealtimeCallback<"system:changed">;
  event: "system:changed";
}

export interface SystemConfigRealtimeOnInput {
  callback: BbRealtimeCallback<"system:config-changed">;
  event: "system:config-changed";
}

export interface SystemAppsRealtimeOnInput {
  callback: BbRealtimeCallback<"system:apps-changed">;
  event: "system:apps-changed";
}

export interface AppRealtimeOnInput {
  callback: BbRealtimeCallback<"app:changed">;
  event: "app:changed";
}

export interface AppDataChangedRealtimeOnInput {
  applicationId?: ApplicationId;
  callback: BbRealtimeCallback<"app-data:changed">;
  event: "app-data:changed";
  prefix?: AppDataPath | "";
}

export interface AppDataResyncRealtimeOnInput {
  applicationId?: ApplicationId;
  callback: BbRealtimeCallback<"app-data:resync">;
  event: "app-data:resync";
}

export interface RealtimeConnectionOnInput {
  callback: BbRealtimeCallback<"realtime:connection">;
  event: "realtime:connection";
}

export type BbRealtimeOnInputUnion =
  | ThreadRealtimeOnInput
  | ProjectRealtimeOnInput
  | EnvironmentRealtimeOnInput
  | HostRealtimeOnInput
  | SystemRealtimeOnInput
  | SystemConfigRealtimeOnInput
  | SystemAppsRealtimeOnInput
  | AppRealtimeOnInput
  | AppDataChangedRealtimeOnInput
  | AppDataResyncRealtimeOnInput
  | RealtimeConnectionOnInput;

export type BbRealtimeOnInput<
  TEventName extends BbRealtimeEventName = BbRealtimeEventName,
> = Extract<BbRealtimeOnInputUnion, { event: TEventName }>;

export interface BbRealtime {
  on<TEventName extends BbRealtimeEventName>(
    input: BbRealtimeOnInput<TEventName>,
  ): BbRealtimeUnsubscribe;
}

export interface BbRealtimeListAppDataEntriesInput {
  applicationId: ApplicationId;
  prefix?: AppDataPath | "";
}

export type BbRealtimeListAppDataEntries = (
  input: BbRealtimeListAppDataEntriesInput,
) => Promise<AppDataEntry[]>;
