import type { ChangedMessage } from "@bb/domain";

export type BbRealtimeUnsubscribe = () => void;

export type BbRealtimeEventName =
  | "thread:changed"
  | "project:changed"
  | "environment:changed"
  | "host:changed"
  | "system:changed"
  | "system:config-changed"
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
 * the next listener receives.
 */
export interface BbRealtimeEventMap {
  "thread:changed": ThreadRealtimeEvent;
  "project:changed": ProjectRealtimeEvent;
  "environment:changed": EnvironmentRealtimeEvent;
  "host:changed": HostRealtimeEvent;
  "system:changed": SystemRealtimeEvent;
  "system:config-changed": SystemRealtimeEvent;
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
  | RealtimeConnectionOnArgs;

export type BbRealtimeOnArgs<
  TEventName extends BbRealtimeEventName = BbRealtimeEventName,
> = Extract<BbRealtimeOnArgsUnion, { event: TEventName }>;

export interface BbRealtime {
  on<TEventName extends BbRealtimeEventName>(
    args: BbRealtimeOnArgs<TEventName>,
  ): BbRealtimeUnsubscribe;
}
