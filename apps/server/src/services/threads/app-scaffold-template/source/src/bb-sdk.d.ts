// GENERATED - do not edit. Run pnpm --filter @bb/sdk generate:app-globals-dts to regenerate.
// Source: @bb/sdk current app runtime types.
export {};

declare global {
  type ApplicationId = string;

  type AppDataPath = string;

  interface JsonObject {
    [key: string]: JsonValue;
  }

  type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

  type ThreadEventType = "thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/warning" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog";

  type ThreadChangeKind = "thread-created" | "thread-deleted" | "events-appended" | "interactions-changed" | "status-changed" | "title-changed" | "queue-changed" | "archived-changed" | "pin-state-changed" | "parent-changed" | "read-state-changed" | "order-changed" | "terminals-changed";

  type ProjectChangeKind = "project-created" | "project-updated" | "project-deleted" | "project-sources-changed" | "threads-changed" | "project-order-changed" | "automations-changed" | "thread-schedules-changed";

  type EnvironmentChangeKind = "status-changed" | "environment-created" | "environment-deleted" | "metadata-changed" | "work-status-changed" | "git-refs-changed" | "thread-storage-changed";

  type HostChangeKind = "host-connected" | "host-disconnected";

  type SystemChangeKind = "config-changed" | "apps-changed";

  type AppChangeKind = "apps-changed" | "content-changed";

  interface ThreadChangeMetadata {
    eventTypes?: readonly ThreadEventType[] | undefined;
    hasPendingInteraction?: boolean | undefined;
    projectId?: string | undefined;
  }

  interface ThreadChangedMessage {
    type: "changed";
    entity: "thread";
    changes: readonly ThreadChangeKind[];
    id?: string | undefined;
    metadata?: ThreadChangeMetadata | undefined;
  }

  interface ProjectChangedMessage {
    type: "changed";
    entity: "project";
    changes: readonly ProjectChangeKind[];
    id?: string | undefined;
  }

  interface EnvironmentChangedMessage {
    type: "changed";
    entity: "environment";
    changes: readonly EnvironmentChangeKind[];
    id?: string | undefined;
  }

  interface HostChangedMessage {
    type: "changed";
    entity: "host";
    changes: readonly HostChangeKind[];
    id?: string | undefined;
  }

  interface SystemChangedMessage {
    type: "changed";
    entity: "system";
    changes: readonly SystemChangeKind[];
  }

  interface AppChangedMessage {
    type: "changed";
    entity: "app";
    changes: readonly AppChangeKind[];
    id?: string | undefined;
  }

  type ChangedMessage = ThreadChangedMessage | ProjectChangedMessage | EnvironmentChangedMessage | HostChangedMessage | SystemChangedMessage | AppChangedMessage;

  type AppDataBroadcastMessage = { type: "app-data.changed"; applicationId: string; path: string; value: JsonValue; deleted: boolean; version: string | null; } | { type: "app-data.resync"; applicationId: string; };

  interface AppDataEntry {
    path: AppDataPath;
    value: JsonValue;
    version: string;
    sizeBytes: number;
    modifiedAtMs: number;
  }

  interface BbDataEntry {
    path: AppDataPath;
    value: JsonValue;
  }

  interface BbDataReadArgs {
    path: AppDataPath;
  }

  interface BbDataWriteArgs extends BbDataReadArgs {
    value: JsonValue;
  }

  interface BbDataDeleteArgs extends BbDataReadArgs {
  }

  interface BbDataListArgs {
    prefix?: AppDataPath | "";
  }

  interface BbDataChangeEvent {
    path: AppDataPath;
    value: JsonValue | undefined;
    deleted: boolean;
  }

  type BbDataChangeCallback = (event: BbDataChangeEvent) => void;

  interface BbDataOnChangeArgs {
    callback: BbDataChangeCallback;
    prefix?: AppDataPath | "";
  }

  interface BbMessageSendArgs {
    payload: JsonValue;
    targetThreadId?: string;
  }

  type BbRealtimeUnsubscribe = () => void;

  type BbRealtimeEventName = "thread:changed" | "project:changed" | "environment:changed" | "host:changed" | "system:changed" | "system:config-changed" | "system:apps-changed" | "app:changed" | "app-data:changed" | "app-data:resync" | "realtime:connection";

  type ThreadRealtimeEvent = Extract<ChangedMessage, {
    entity: "thread";
  }>;

  type ProjectRealtimeEvent = Extract<ChangedMessage, {
    entity: "project";
  }>;

  type EnvironmentRealtimeEvent = Extract<ChangedMessage, {
    entity: "environment";
  }>;

  type HostRealtimeEvent = Extract<ChangedMessage, {
    entity: "host";
  }>;

  type SystemRealtimeEvent = Extract<ChangedMessage, {
    entity: "system";
  }>;

  type AppRealtimeEvent = Extract<ChangedMessage, {
    entity: "app";
  }>;

  type AppDataChangedRealtimeEvent = Extract<AppDataBroadcastMessage, {
    type: "app-data.changed";
  }>;

  type AppDataResyncRealtimeEvent = Extract<AppDataBroadcastMessage, {
    type: "app-data.resync";
  }>;

  type BbRealtimeConnectionState = "connecting" | "connected" | "disconnected";

  interface BbRealtimeConnectionEvent {
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
  interface BbRealtimeEventMap {
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

  type BbRealtimeCallback<TEventName extends BbRealtimeEventName> = (event: BbRealtimeEventMap[TEventName]) => void;

  interface ThreadRealtimeOnArgs {
    callback: BbRealtimeCallback<"thread:changed">;
    event: "thread:changed";
    threadId?: string;
  }

  interface ProjectRealtimeOnArgs {
    callback: BbRealtimeCallback<"project:changed">;
    event: "project:changed";
    projectId?: string;
  }

  interface EnvironmentRealtimeOnArgs {
    callback: BbRealtimeCallback<"environment:changed">;
    environmentId?: string;
    event: "environment:changed";
  }

  interface HostRealtimeOnArgs {
    callback: BbRealtimeCallback<"host:changed">;
    event: "host:changed";
    hostId?: string;
  }

  interface SystemRealtimeOnArgs {
    callback: BbRealtimeCallback<"system:changed">;
    event: "system:changed";
  }

  interface SystemConfigRealtimeOnArgs {
    callback: BbRealtimeCallback<"system:config-changed">;
    event: "system:config-changed";
  }

  interface SystemAppsRealtimeOnArgs {
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
  interface AppRealtimeOnArgs {
    callback: BbRealtimeCallback<"app:changed">;
    event: "app:changed";
  }

  interface AppDataChangedRealtimeOnArgs {
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
  interface AppDataResyncRealtimeOnArgs {
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
  interface RealtimeConnectionOnArgs {
    callback: BbRealtimeCallback<"realtime:connection">;
    event: "realtime:connection";
  }

  type BbRealtimeOnArgsUnion = ThreadRealtimeOnArgs | ProjectRealtimeOnArgs | EnvironmentRealtimeOnArgs | HostRealtimeOnArgs | SystemRealtimeOnArgs | SystemConfigRealtimeOnArgs | SystemAppsRealtimeOnArgs | AppRealtimeOnArgs | AppDataChangedRealtimeOnArgs | AppDataResyncRealtimeOnArgs | RealtimeConnectionOnArgs;

  type BbRealtimeOnArgs<TEventName extends BbRealtimeEventName = BbRealtimeEventName> = Extract<BbRealtimeOnArgsUnion, {
    event: TEventName;
  }>;

  interface BbRealtime {
    on<TEventName extends BbRealtimeEventName>(args: BbRealtimeOnArgs<TEventName>): BbRealtimeUnsubscribe;
  }

  type CurrentAppDataReadArgs = BbDataReadArgs;

  type CurrentAppDataWriteArgs = BbDataWriteArgs;

  type CurrentAppDataDeleteArgs = BbDataDeleteArgs;

  type CurrentAppDataListArgs = BbDataListArgs;

  type CurrentAppDataEntry = BbDataEntry;

  type CurrentAppDataChangeEvent = BbDataChangeEvent;

  type CurrentAppDataChangeCallback = BbDataChangeCallback;

  type CurrentAppDataChangeArgs = BbDataOnChangeArgs;

  type CurrentAppMessageSendArgs = BbMessageSendArgs;

  interface CurrentAppDataArea {
    delete(args: CurrentAppDataDeleteArgs): Promise<void>;
    entries(args?: CurrentAppDataListArgs): Promise<AppDataEntry[]>;
    list(args?: CurrentAppDataListArgs): Promise<CurrentAppDataEntry[]>;
    onChange(args: CurrentAppDataChangeArgs): () => void;
    read(args: CurrentAppDataReadArgs): Promise<JsonValue | undefined>;
    write(args: CurrentAppDataWriteArgs): Promise<void>;
  }

  interface CurrentAppMessageArea {
    send(args: CurrentAppMessageSendArgs): Promise<void>;
  }

  type BbData = CurrentAppDataArea;

  type BbMessage = CurrentAppMessageArea;

  /**
   * The stable contract for the `window.bb` runtime injected into served app
   * pages. The installed object is the full SDK (`InjectedBbSdk` in
   * app-runtime-core.ts); this interface declares the subset app authors
   * should rely on. The runtime always knows which app it serves, so both id
   * fields are required.
   */
  interface Bb extends BbRealtime {
    /** @deprecated Alias of `applicationId`. */
    appId: ApplicationId;
    applicationId: ApplicationId;
    data: CurrentAppDataArea;
    message: CurrentAppMessageArea;
  }

  interface Window {
    bb?: Bb;
  }
}
