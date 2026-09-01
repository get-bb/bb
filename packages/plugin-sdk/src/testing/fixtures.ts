import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type QueueEntry = PluginThreadEventPayloads["message.queued"]["entry"];
type TurnFailedEvent = PluginThreadEventPayloads["turn.failed"];

/**
 * A complete, deterministic `ThreadResponse` for thread lifecycle event
 * payloads (`harness.emitThreadEvent`). Defaults are the minimal idle
 * thread; override the fields the test cares about. If the contract grows a
 * required field, this builder fails typecheck — update the default here.
 */
export function makeThreadResponse(
  overrides: Partial<ThreadResponse> = {},
): ThreadResponse {
  return {
    id: "thread-1",
    projectId: "project-1",
    environmentId: null,
    providerId: "test-provider",
    title: null,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    activeBackgroundAgentCount: 0,
    canSpawnChild: true,
    queuedMessageCount: 0,
    ...overrides,
  };
}

/**
 * A complete, deterministic queued row for the `message.*` event payloads
 * and for faking `sdk.threads.queuedMessages.list`. Defaults are a live inline
 * row on this plugin's wait; override what the test is about. If the
 * contract grows a required field, this builder fails typecheck — update the
 * default here.
 */
export function makeQueueEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "queued_1",
    threadId: "thread-1",
    content: [{ type: "text", text: "Queued turn", mentions: [] }],
    model: "test-model",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    sendAt: null,
    waitingOn: {
      kind: "plugin",
      pluginId: "test-plugin",
      reason: "Waiting",
    },
    failureReason: null,
    payload: { kind: "inline" },
    editable: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * A complete, deterministic `turn.failed` payload. Defaults are a first attempt
 * that failed inside a provider turn with neither structured error info nor
 * rate limits — the shape a retry policy must handle before it handles the
 * interesting ones. If the contract grows a required field, this builder fails
 * typecheck — update the default here.
 */
export function makeTurnFailedEvent(
  overrides: Partial<TurnFailedEvent> = {},
): TurnFailedEvent {
  return {
    threadId: "thread-1",
    requestId: "creq_2222222222",
    turnId: "turn-1",
    errorInfo: null,
    inputAccepted: true,
    rateLimits: null,
    attemptNumber: 1,
    ...overrides,
  };
}
