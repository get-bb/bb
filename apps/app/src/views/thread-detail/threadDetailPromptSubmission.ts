import type {
  PermissionMode,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type {
  CreateQueuedMessageRequest,
  ExistingThreadExecutionInputSources,
} from "@bb/server-contract";
import type { FollowUpSubmitMode } from "@/components/promptbox/FollowUpPromptBox";
import type { SendMessageMutationRequest } from "./threadDetailMutationTypes";

export interface CreateQueuedFollowUpRequest extends CreateQueuedMessageRequest {
  id: string;
}

export interface SendQueuedMessageByIdRequest {
  id: string;
  mode: "auto";
  queuedMessageId: string;
}

export interface ThreadExecutionSelection {
  model: string;
  permissionMode: PermissionMode;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  supportsServiceTier: boolean;
  executionInputSources: ExistingThreadExecutionInputSources;
}

export type FollowUpExecutionSelection = ThreadExecutionSelection | null;

interface SharedThreadExecutionRequestFields {
  model?: string;
  permissionMode?: PermissionMode;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: ServiceTier;
  executionInputSources?: ExistingThreadExecutionInputSources;
}

interface BaseFollowUpRequestArgs {
  input: PromptInput[];
  threadId: string;
}

export interface BuildAutoFollowUpRequestArgs extends BaseFollowUpRequestArgs {
  execution: FollowUpExecutionSelection;
}

export interface BuildCreateQueuedFollowUpRequestArgs extends BaseFollowUpRequestArgs {
  execution: FollowUpExecutionSelection;
}

export interface BuildSendQueuedMessageByIdRequestArgs {
  queuedMessageId: string;
  threadId: string;
}

export interface BuildFollowUpShortcutRequestArgs extends BaseFollowUpRequestArgs {
  queuedMessages: readonly QueuedMessageForSend[];
}

export interface CanSubmitFollowUpShortcutArgs {
  hasPromptDraftInput: boolean;
  isFollowUpSubmitting: boolean;
  isQueueMutationPending: boolean;
  queuedMessageCount: number;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  submitModeKind: FollowUpSubmitMode["kind"];
}

export interface BuildFollowUpSubmitModeArgs {
  hasPendingInteraction: boolean;
  isDefaultExecutionOptionsLoading: boolean;
  isPendingInteractionsInitialLoading: boolean;
  isStopRequested: boolean;
  onStop: () => void;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
}

export interface BuildSideChatSubmitModeArgs {
  childThreadId: string | null;
  isDefaultExecutionOptionsLoading: boolean;
  isStopRequested: boolean;
  onStop: () => void;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
}

export interface ResolveDefaultExecutionOptionsStateArgs {
  hasConcreteDefaultExecutionOptions: boolean;
  hasResolvedDefaultExecutionOptions: boolean;
  isError: boolean;
}

export interface QueuedMessageForSend {
  id: string;
}

export type FollowUpShortcutRequest =
  | { kind: "draft"; request: SendMessageMutationRequest }
  | { kind: "queued"; request: SendQueuedMessageByIdRequest };

export type DefaultExecutionOptionsState =
  | "available"
  | "loading"
  | "unavailable";

export function shouldQueueFollowUpMessage(
  displayStatus: ThreadRuntimeDisplayStatus,
): boolean {
  return (
    displayStatus === "active" ||
    displayStatus === "host-reconnecting" ||
    displayStatus === "provisioning" ||
    displayStatus === "starting" ||
    displayStatus === "waiting-for-host"
  );
}

export function buildFollowUpSubmitMode({
  hasPendingInteraction,
  isDefaultExecutionOptionsLoading,
  isPendingInteractionsInitialLoading,
  isStopRequested,
  onStop,
  runtimeDisplayStatus,
}: BuildFollowUpSubmitModeArgs): FollowUpSubmitMode {
  if (isStopRequested) {
    return { kind: "blocked", reason: "stopping" };
  }
  if (isPendingInteractionsInitialLoading) {
    return { kind: "blocked", reason: "loading-pending-interactions" };
  }
  if (hasPendingInteraction) {
    return { kind: "blocked", reason: "pending-interaction" };
  }
  if (shouldQueueFollowUpMessage(runtimeDisplayStatus)) {
    return { kind: "queue", onStop };
  }
  if (isDefaultExecutionOptionsLoading) {
    return { kind: "blocked", reason: "loading-execution-options" };
  }
  return { kind: "ready" };
}

export function buildSideChatSubmitMode({
  childThreadId,
  isDefaultExecutionOptionsLoading,
  isStopRequested,
  onStop,
  runtimeDisplayStatus,
}: BuildSideChatSubmitModeArgs): FollowUpSubmitMode {
  if (childThreadId === null) {
    return isDefaultExecutionOptionsLoading
      ? { kind: "blocked", reason: "loading-execution-options" }
      : { kind: "ready" };
  }
  return buildFollowUpSubmitMode({
    hasPendingInteraction: false,
    isDefaultExecutionOptionsLoading,
    isPendingInteractionsInitialLoading: false,
    isStopRequested,
    onStop,
    runtimeDisplayStatus,
  });
}

export function canSubmitFollowUpShortcut({
  hasPromptDraftInput,
  isFollowUpSubmitting,
  isQueueMutationPending,
  queuedMessageCount,
  runtimeDisplayStatus,
  submitModeKind,
}: CanSubmitFollowUpShortcutArgs): boolean {
  return (
    runtimeDisplayStatus === "active" &&
    submitModeKind === "queue" &&
    !isFollowUpSubmitting &&
    !isQueueMutationPending &&
    (queuedMessageCount > 0 || hasPromptDraftInput)
  );
}

export function resolveDefaultExecutionOptionsState({
  hasConcreteDefaultExecutionOptions,
  hasResolvedDefaultExecutionOptions,
  isError,
}: ResolveDefaultExecutionOptionsStateArgs): DefaultExecutionOptionsState {
  if (hasConcreteDefaultExecutionOptions) {
    return "available";
  }
  if (hasResolvedDefaultExecutionOptions || isError) {
    return "unavailable";
  }
  return "loading";
}

export function buildAutoFollowUpRequest({
  execution,
  input,
  threadId,
}: BuildAutoFollowUpRequestArgs): SendMessageMutationRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    mode: "queue-if-active",
    ...buildSharedThreadExecutionRequestFields(execution),
  };
}

function buildSteerFollowUpRequest({
  input,
  threadId,
}: BaseFollowUpRequestArgs): SendMessageMutationRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    mode: "steer-if-active",
  };
}

export function buildCreateQueuedFollowUpRequest({
  execution,
  input,
  threadId,
}: BuildCreateQueuedFollowUpRequestArgs): CreateQueuedFollowUpRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    ...buildSharedThreadExecutionRequestFields(execution),
  };
}

export function buildSendQueuedMessageByIdRequest({
  queuedMessageId,
  threadId,
}: BuildSendQueuedMessageByIdRequestArgs): SendQueuedMessageByIdRequest {
  return {
    id: threadId,
    mode: "auto",
    queuedMessageId,
  };
}

/**
 * Cmd+Enter on an active follow-up composer sends current draft input as an
 * explicit steer. If the composer is empty, it sends only the current queue
 * head through the same auto path as the queued-card "Send now" action.
 */
export function buildFollowUpShortcutRequest({
  input,
  queuedMessages,
  threadId,
}: BuildFollowUpShortcutRequestArgs): FollowUpShortcutRequest | null {
  const draftRequest = buildSteerFollowUpRequest({ input, threadId });
  if (draftRequest) {
    return { kind: "draft", request: draftRequest };
  }

  const nextQueuedMessage = queuedMessages[0];
  if (!nextQueuedMessage) {
    return null;
  }

  return {
    kind: "queued",
    request: buildSendQueuedMessageByIdRequest({
      queuedMessageId: nextQueuedMessage.id,
      threadId,
    }),
  };
}

function buildSharedThreadExecutionRequestFields(
  execution: FollowUpExecutionSelection,
): SharedThreadExecutionRequestFields {
  if (execution === null) {
    return {};
  }

  return {
    model: execution.model,
    ...(execution.supportsServiceTier && execution.serviceTier
      ? { serviceTier: execution.serviceTier }
      : {}),
    reasoningLevel: execution.reasoningLevel,
    permissionMode: execution.permissionMode,
    executionInputSources: execution.executionInputSources,
  };
}
