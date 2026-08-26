import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type DispatchHoldResponse = PluginThreadEventPayloads["dispatch.held"]["hold"];

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
    liveDispatchHoldCount: 0,
    ...overrides,
  };
}

/**
 * A complete, deterministic `DispatchHoldResponse` for the `dispatch.*` event
 * payloads and for faking `sdk.threads.holds.list`. Defaults are a live
 * plugin-owned inline hold with no timer; override what the test is about. If
 * the contract grows a required field, this builder fails typecheck — update
 * the default here.
 */
export function makeDispatchHoldResponse(
  overrides: Partial<DispatchHoldResponse> = {},
): DispatchHoldResponse {
  return {
    id: "hold_1",
    kind: "turn",
    threadId: "thread-1",
    holder: "plugin:test-plugin",
    userReleasable: true,
    reason: "Held",
    payload: {
      kind: "inline",
      input: [{ type: "text", text: "Held turn", mentions: [] }],
      execution: {
        model: "test-model",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "auto",
        source: "client/turn/requested",
      },
      editable: true,
    },
    resumeAt: null,
    expectedReleaseAt: null,
    staleAfterMs: null,
    lastReportAt: null,
    createdAt: 0,
    releasedAt: null,
    releaseKind: null,
    ...overrides,
  };
}
