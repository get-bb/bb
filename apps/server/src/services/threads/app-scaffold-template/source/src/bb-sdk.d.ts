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

  type ThreadEventType = "thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/warning" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog";

  type ThreadChangeKind = "thread-created" | "thread-deleted" | "events-appended" | "interactions-changed" | "status-changed" | "title-changed" | "queue-changed" | "archived-changed" | "pin-state-changed" | "parent-changed" | "read-state-changed" | "manager-assignment-changed" | "order-changed" | "terminals-changed";

  type ProjectChangeKind = "project-created" | "project-updated" | "project-deleted" | "project-sources-changed" | "threads-changed" | "project-order-changed" | "automations-changed" | "nudges-changed";

  type EnvironmentChangeKind = "status-changed" | "environment-created" | "environment-deleted" | "metadata-changed" | "work-status-changed" | "git-refs-changed" | "thread-storage-changed";

  type HostChangeKind = "host-connected" | "host-disconnected";

  type SystemChangeKind = "config-changed" | "apps-changed";

  type AppChangeKind = "apps-changed";

  interface ThreadChangeMetadata {
    eventTypes?: readonly ThreadEventType[];
    hasPendingInteraction?: boolean;
    projectId?: string;
  }

  interface ThreadChangedMessage {
    type: "changed";
    entity: "thread";
    id?: string;
    metadata?: ThreadChangeMetadata;
    changes: ThreadChangeKind[];
  }

  interface ProjectChangedMessage {
    type: "changed";
    entity: "project";
    id?: string;
    changes: ProjectChangeKind[];
  }

  interface EnvironmentChangedMessage {
    type: "changed";
    entity: "environment";
    id?: string;
    changes: EnvironmentChangeKind[];
  }

  interface HostChangedMessage {
    type: "changed";
    entity: "host";
    id?: string;
    changes: HostChangeKind[];
  }

  interface SystemChangedMessage {
    type: "changed";
    entity: "system";
    changes: SystemChangeKind[];
  }

  interface AppChangedMessage {
    type: "changed";
    entity: "app";
    id?: string;
    changes: AppChangeKind[];
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

  interface ThreadRealtimeOnInput {
    callback: BbRealtimeCallback<"thread:changed">;
    event: "thread:changed";
    threadId?: string;
  }

  interface ProjectRealtimeOnInput {
    callback: BbRealtimeCallback<"project:changed">;
    event: "project:changed";
    projectId?: string;
  }

  interface EnvironmentRealtimeOnInput {
    callback: BbRealtimeCallback<"environment:changed">;
    environmentId?: string;
    event: "environment:changed";
  }

  interface HostRealtimeOnInput {
    callback: BbRealtimeCallback<"host:changed">;
    event: "host:changed";
    hostId?: string;
  }

  interface SystemRealtimeOnInput {
    callback: BbRealtimeCallback<"system:changed">;
    event: "system:changed";
  }

  interface SystemConfigRealtimeOnInput {
    callback: BbRealtimeCallback<"system:config-changed">;
    event: "system:config-changed";
  }

  interface SystemAppsRealtimeOnInput {
    callback: BbRealtimeCallback<"system:apps-changed">;
    event: "system:apps-changed";
  }

  interface AppRealtimeOnInput {
    callback: BbRealtimeCallback<"app:changed">;
    event: "app:changed";
  }

  interface AppDataChangedRealtimeOnInput {
    applicationId?: ApplicationId;
    callback: BbRealtimeCallback<"app-data:changed">;
    event: "app-data:changed";
    prefix?: AppDataPath | "";
  }

  interface AppDataResyncRealtimeOnInput {
    applicationId?: ApplicationId;
    callback: BbRealtimeCallback<"app-data:resync">;
    event: "app-data:resync";
  }

  interface RealtimeConnectionOnInput {
    callback: BbRealtimeCallback<"realtime:connection">;
    event: "realtime:connection";
  }

  type BbRealtimeOnInputUnion = ThreadRealtimeOnInput | ProjectRealtimeOnInput | EnvironmentRealtimeOnInput | HostRealtimeOnInput | SystemRealtimeOnInput | SystemConfigRealtimeOnInput | SystemAppsRealtimeOnInput | AppRealtimeOnInput | AppDataChangedRealtimeOnInput | AppDataResyncRealtimeOnInput | RealtimeConnectionOnInput;

  type BbRealtimeOnInput<TEventName extends BbRealtimeEventName = BbRealtimeEventName> = Extract<BbRealtimeOnInputUnion, {
    event: TEventName;
  }>;

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

  interface Bb {
    appId?: ApplicationId;
    applicationId?: ApplicationId;
    data: CurrentAppDataArea;
    message: CurrentAppMessageArea;
    on<TEventName extends BbRealtimeEventName>(input: BbRealtimeOnInput<TEventName>): BbRealtimeUnsubscribe;
  }

  interface Window {
    bb?: Bb;
  }
}
