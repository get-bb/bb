import type {
  BackgroundTaskStatus,
  BackgroundTaskUsage,
  JsonObject,
  OwnershipChangeOperationMetadata,
  PendingInteractionUserAnswer,
  PendingInteractionUserQuestionQuestion,
  ProviderErrorInfo,
  PromptTextMention,
  SystemMessageKind,
  SystemMessageSubject,
  Thread,
  ThreadEventRow,
  ThreadEventScope,
  ThreadTurnInitiator,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import type { EventProjection } from "./event-projection.js";

export const eventProjectionMessageStatusValues = [
  "streaming",
  "pending",
  "completed",
  "error",
  "interrupted",
] as const;
export type EventProjectionMessageStatus =
  (typeof eventProjectionMessageStatusValues)[number];

export const eventProjectionApprovalLifecycleStatusValues = [
  "waiting_for_approval",
  "denied",
] as const;
export type EventProjectionApprovalLifecycleStatus =
  (typeof eventProjectionApprovalLifecycleStatusValues)[number];

export const eventProjectionPermissionGrantLifecycleValues = [
  "pending",
  "resolving",
  "granted",
  "denied",
  "interrupted",
] as const;
export type EventProjectionPermissionGrantLifecycle =
  (typeof eventProjectionPermissionGrantLifecycleValues)[number];
export const eventProjectionUserQuestionLifecycleValues = [
  "pending",
  "resolving",
  "answered",
  "interrupted",
] as const;
export type EventProjectionUserQuestionLifecycle =
  (typeof eventProjectionUserQuestionLifecycleValues)[number];

export interface EventProjectionMessageBase {
  id: string;
  threadId: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
  scope: ThreadEventScope;
  startedAt?: number;
  parentToolCallId?: string;
}

export const eventProjectionTurnRequestKindValues = [
  "message",
  "steer",
] as const;
export type EventProjectionTurnRequestKind =
  (typeof eventProjectionTurnRequestKindValues)[number];

export const eventProjectionTurnRequestStatusValues = [
  "pending",
  "accepted",
] as const;
export type EventProjectionTurnRequestStatus =
  (typeof eventProjectionTurnRequestStatusValues)[number];

export interface EventProjectionTurnRequest {
  kind: EventProjectionTurnRequestKind;
  status: EventProjectionTurnRequestStatus;
}

export interface EventProjectionUserMessage extends EventProjectionMessageBase {
  kind: "user";
  initiator: ThreadTurnInitiator;
  senderThreadId: string | null;
  // Family-B taxonomy fields carried from the decoded `client/turn/requested`
  // event. Legacy events lacking them project as `unlabeled` / `null`.
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
  turnRequest: EventProjectionTurnRequest;
  text: string;
  mentions: PromptTextMention[];
  attachments?: {
    webImages: number;
    localImages: number;
    localFiles: number;
    imageUrls?: string[];
    localImagePaths?: string[];
    localFilePaths?: string[];
  };
}

export interface EventProjectionAssistantTextMessage extends EventProjectionMessageBase {
  kind: "assistant-text";
  text: string;
  status: Extract<EventProjectionMessageStatus, "streaming" | "completed">;
  /** True when this message came from a legacy persisted user-visible system event. */
  isLegacyUserMessage?: boolean;
}

export type EventProjectionToolParsedIntent =
  | {
      type: "read";
      cmd: string;
      name: string;
      path: string | null;
    }
  | {
      type: "list_files";
      cmd: string;
      path: string | null;
    }
  | {
      type: "search";
      cmd: string;
      query: string | null;
      path: string | null;
    }
  | {
      type: "unknown";
      cmd: string;
    };

export interface EventProjectionDelegationMetadata {
  subagentType?: string;
  description?: string;
}

export interface EventProjectionToolCallMessage extends EventProjectionMessageBase {
  kind: "tool-call";
  toolName: string;
  toolArgs: JsonObject | null;
  callId: string;
  parsedIntents: EventProjectionToolParsedIntent[];
  output: string;
  completedAt: number | null;
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
}

export interface EventProjectionCommandMessage extends EventProjectionMessageBase {
  kind: "command";
  callId: string;
  command: string;
  cwd: string | null;
  parsedIntents: EventProjectionToolParsedIntent[];
  source: string | null;
  output: string;
  exitCode: number | null;
  completedAt: number | null;
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
}

export interface EventProjectionWebSearchMessage extends EventProjectionMessageBase {
  kind: "web-search";
  callId: string;
  queries: string[];
  completedAt: number | null;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "interrupted"
  >;
}

export interface EventProjectionWebFetchMessage extends EventProjectionMessageBase {
  kind: "web-fetch";
  callId: string;
  url: string;
  prompt: string | null;
  pattern: string | null;
  completedAt: number | null;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "interrupted"
  >;
}

export interface EventProjectionImageViewMessage extends EventProjectionMessageBase {
  kind: "image-view";
  callId: string;
  path: string;
  completedAt: number | null;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "interrupted"
  >;
}

export interface EventProjectionFileEditChange {
  path: string;
  kind?: string;
  movePath?: string | null;
  diff?: string;
}

export interface EventProjectionFileEditMessage extends EventProjectionMessageBase {
  kind: "file-edit";
  callId: string;
  changes: EventProjectionFileEditChange[];
  stdout?: string;
  stderr?: string;
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
}

export const eventProjectionOperationTypeValues = [
  "provider-unhandled",
  "warning",
  "deprecation",
  "thread-interrupted",
  "thread-provisioning",
  "operation",
  "compaction",
] as const;
export type EventProjectionOperationType =
  (typeof eventProjectionOperationTypeValues)[number];

export const eventProjectionThreadOperationKindValues = [
  "ownership_change",
  "other",
] as const;
export type EventProjectionThreadOperationKind =
  (typeof eventProjectionThreadOperationKindValues)[number];

export const eventProjectionThreadOperationStatusValues = [
  "requested",
  "queued",
  "running",
  "started",
  "completed",
  "failed",
  "noop",
  "other",
] as const;
export type EventProjectionThreadOperationStatus =
  (typeof eventProjectionThreadOperationStatusValues)[number];

export interface EventProjectionOwnershipChangeThreadOperationMetadata {
  operation: "ownership_change";
  rawOperation: string;
  status: EventProjectionThreadOperationStatus;
  rawStatus: string;
  operationId: string;
  metadata: OwnershipChangeOperationMetadata | null;
}

export interface EventProjectionOtherThreadOperationMetadata {
  operation: "other";
  rawOperation: string;
  status: EventProjectionThreadOperationStatus;
  rawStatus: string;
  operationId: string;
  metadata?: JsonObject;
}

export type EventProjectionThreadOperationMetadata =
  | EventProjectionOwnershipChangeThreadOperationMetadata
  | EventProjectionOtherThreadOperationMetadata;

export interface EventProjectionProvisioningTranscriptEntry {
  type: "step" | "output";
  key: string;
  text: string;
  startedAt?: number;
  status?: "started" | "completed" | "failed";
  metadata?: Record<string, unknown>;
}

export interface EventProjectionProvisioningMetadata {
  environmentId?: string;
  provisioningId: string;
  transcript?: EventProjectionProvisioningTranscriptEntry[];
}

export interface EventProjectionApprovalTarget {
  itemId: string;
  toolName: string | null;
}

export type EventProjectionPermissionGrantGrantScope = "turn" | "session";

export interface EventProjectionOperationMessage extends EventProjectionMessageBase {
  kind: "operation";
  opType: EventProjectionOperationType;
  title: string;
  detail?: string;
  status?: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
  completedAt: number | null;
  provisioning?: EventProjectionProvisioningMetadata;
  threadOperation?: EventProjectionThreadOperationMetadata;
}

export interface EventProjectionPermissionGrantLifecycleMessage extends EventProjectionMessageBase {
  kind: "permission-grant-lifecycle";
  interactionId: string;
  lifecycle: EventProjectionPermissionGrantLifecycle;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
  approvalTarget: EventProjectionApprovalTarget;
  grantScope: EventProjectionPermissionGrantGrantScope | null;
  statusReason: string | null;
}

export interface EventProjectionUserQuestionLifecycleMessage extends EventProjectionMessageBase {
  kind: "user-question-lifecycle";
  interactionId: string;
  lifecycle: EventProjectionUserQuestionLifecycle;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
  questions: PendingInteractionUserQuestionQuestion[];
  answers: Record<string, PendingInteractionUserAnswer> | null;
  statusReason: string | null;
}

export interface EventProjectionDelegationMessage
  extends EventProjectionMessageBase, EventProjectionDelegationMetadata {
  kind: "delegation";
  toolName: string;
  callId: string;
  output: string;
  completedAt: number | null;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
  childProjection: EventProjection;
}

/**
 * A provider background task — a dynamic workflow or a backgrounded shell
 * command, discriminated by `taskType`. One message per item across the whole
 * thread: the turn-scoped item/started anchors placement and later
 * thread-scoped progress/completed events replace its payload in place.
 */
export interface EventProjectionWorkflowMessage extends EventProjectionMessageBase {
  kind: "workflow";
  itemId: string;
  /** Raw SDK task discriminant (e.g. "local_workflow", "local_bash"). */
  taskType: string;
  workflowName: string | null;
  description: string;
  status: Extract<
    EventProjectionMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
  taskStatus: BackgroundTaskStatus;
  skipTranscript: boolean;
  workflow: WorkflowProgressSnapshot | null;
  usage: BackgroundTaskUsage | null;
  summary: string | null;
  error: string | null;
  completedAt: number | null;
}

export interface EventProjectionErrorMessage extends EventProjectionMessageBase {
  kind: "error";
  message: string;
  detail: string | null;
  rawType: string;
  providerErrorInfo?: ProviderErrorInfo;
  reconnectAttempt?: number;
  reconnectTotal?: number;
  willRetry?: boolean;
}

export interface EventProjectionDebugRawEventMessage extends EventProjectionMessageBase {
  kind: "debug/raw-event";
  rawType: string;
  rawEvent: ThreadEventRow;
  reason: "ignored-noise" | "duplicate-event" | "unhandled";
}

export type EventProjectionMessage =
  | EventProjectionUserMessage
  | EventProjectionAssistantTextMessage
  | EventProjectionCommandMessage
  | EventProjectionToolCallMessage
  | EventProjectionWebSearchMessage
  | EventProjectionWebFetchMessage
  | EventProjectionImageViewMessage
  | EventProjectionFileEditMessage
  | EventProjectionOperationMessage
  | EventProjectionPermissionGrantLifecycleMessage
  | EventProjectionUserQuestionLifecycleMessage
  | EventProjectionDelegationMessage
  | EventProjectionWorkflowMessage
  | EventProjectionErrorMessage
  | EventProjectionDebugRawEventMessage;

export interface BuildEventProjectionMessagesOptions {
  includeDebugRawEvents?: boolean;
  includeProviderUnhandledOperations?: boolean;
  threadStatus?: Thread["status"];
  /**
   * Display name of the thread these messages belong to. Used by operation rows
   * that describe a relationship to another thread. Empty string when the thread
   * has no name; the title builders fall back to a bare verb.
   */
  threadName: string;
}
