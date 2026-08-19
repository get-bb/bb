import { z } from "zod";
import {
  activeThinkingSchema,
  callerExecutionInputSourceSchema,
  environmentSchema,
  hostSchema,
  jsonValueSchema,
  pendingInteractionResolutionSchema,
  pendingInteractionSchema,
  permissionModeInputSchema,
  promptInputSchema,
  reasoningLevelSchema,
  rawThreadIdSchema,
  serviceTierSchema,
  threadOriginKindSchema,
  threadListEntrySchema,
  threadQueuedMessageSchema,
  threadSearchSourceKindSchema,
  threadTimelineActivePromptModeSchema,
  threadTimelineGoalSchema,
  threadTimelineModelFallbackSchema,
  threadTimelinePendingTodosSchema,
  threadEventTypeValues,
  threadVisibilitySchema,
  threadWithRuntimeSchema,
} from "@bb/domain";
import type { CallerExecutionInputSource } from "@bb/domain";
import {
  timelineDeltaSchema,
  timelineRowSchema,
  timelineWorkflowWorkRowSchema,
} from "../thread-timeline.js";
import {
  createThreadEnvironmentArgsSchema,
  FILE_LIST_QUERY_MAX_LENGTH,
  isCommaSeparatedIncludeQueryValue,
  pathListIncludeQueryValueSchema,
  threadContextWindowUsageSchema,
  workspaceFileListResponseSchema,
  workspacePathListResponseSchema,
} from "./shared.js";

export const sendMessageModeSchema = z.enum([
  "queue-if-active",
  "steer-if-active",
  "auto",
  "start",
  "steer",
]);

export const threadCreateOriginSchema = z.enum(["app", "cli", "sdk", "plugin"]);
export type ThreadCreateOrigin = z.infer<typeof threadCreateOriginSchema>;

export const executionInputFieldSourceSchema = callerExecutionInputSourceSchema;
export type ExecutionInputFieldSource = CallerExecutionInputSource;

export const createExecutionInputSourcesSchema = z
  .object({
    providerId: executionInputFieldSourceSchema.optional(),
    model: executionInputFieldSourceSchema.optional(),
    serviceTier: executionInputFieldSourceSchema.optional(),
    reasoningLevel: executionInputFieldSourceSchema.optional(),
    permissionMode: executionInputFieldSourceSchema.optional(),
  })
  .strict();
export type CreateExecutionInputSources = z.infer<
  typeof createExecutionInputSourcesSchema
>;

export const existingThreadExecutionInputSourcesSchema = z
  .object({
    model: executionInputFieldSourceSchema.optional(),
    serviceTier: executionInputFieldSourceSchema.optional(),
    reasoningLevel: executionInputFieldSourceSchema.optional(),
    permissionMode: executionInputFieldSourceSchema.optional(),
  })
  .strict();
export type ExistingThreadExecutionInputSources = z.infer<
  typeof existingThreadExecutionInputSourcesSchema
>;

// "started on behalf of another thread/agent": the thread-start turn is
// attributed to {initiator} and rendered as "Message from {senderThreadId}".
// null ⇒ a normal user-initiated start. A non-null value also flags the
// thread-start turn as seed-without-run (the started agent waits for the user's
// first message), mirroring the `client/turn/requested` event whose
// `senderThreadId` is non-null only for agent/system starts.
export const startedOnBehalfOfInitiatorSchema = z.enum(["agent", "system"]);
export type StartedOnBehalfOfInitiator = z.infer<
  typeof startedOnBehalfOfInitiatorSchema
>;

export const startedOnBehalfOfSchema = z.object({
  initiator: startedOnBehalfOfInitiatorSchema,
  senderThreadId: z.string().min(1),
});
export type StartedOnBehalfOf = z.infer<typeof startedOnBehalfOfSchema>;

export const createThreadRequestSchema = z
  .object({
    projectId: z.string().min(1),
    providerId: z.string().min(1).optional(),
    origin: threadCreateOriginSchema,
    /**
     * Id of the plugin that spawned this thread. Present exactly when
     * origin is "plugin" (enforced below); persisted for attribution.
     */
    originPluginId: z.string().min(1).optional(),
    /**
     * Hidden threads stay out of sidebar organization and attention surfaces.
     * Omitted, a child inherits parentThreadId's visibility and a root is
     * visible; side chats stay hidden.
     */
    visibility: threadVisibilitySchema.optional(),
    title: z.string().min(1).optional(),
    // A source-derived side-chat preload may establish the cloned provider
    // session without a first prompt. Normal starts and forks require at least
    // one input entry, enforced by the refinement below rather than a blanket
    // `.min(1)`.
    input: z.array(promptInputSchema),
    model: z.string().min(1).optional(),
    serviceTier: serviceTierSchema.optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    permissionMode: permissionModeInputSchema.optional(),
    executionInputSources: createExecutionInputSourcesSchema.optional(),
    environment: createThreadEnvironmentArgsSchema,
    parentThreadId: z.string().min(1).optional(),
    sectionId: z.string().min(1).nullable().optional(),
    sourceThreadId: z.string().min(1).optional(),
    sourceSeqEnd: z.number().int().nonnegative().optional(),
    startedOnBehalfOf: startedOnBehalfOfSchema.nullable().default(null),
    originKind: threadOriginKindSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.origin === "plugin" && value.originPluginId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: 'originPluginId is required when origin is "plugin"',
        path: ["originPluginId"],
      });
    }
    if (value.origin !== "plugin" && value.originPluginId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: 'originPluginId requires origin "plugin"',
        path: ["originPluginId"],
      });
    }
    if (value.originKind === null && value.input.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "input must contain at least one entry",
        path: ["input"],
      });
    }
    if (value.originKind === null && value.sourceSeqEnd !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "sourceSeqEnd requires an originKind",
        path: ["sourceSeqEnd"],
      });
    }
  });
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

const agentOnlyPromptInputSchema = promptInputSchema.and(
  z.object({ visibility: z.literal("agent-only") }),
);

export const forkThreadRequestSchema = z
  .object({
    sourceThreadId: z.string().min(1),
    sourceSeqEnd: z.number().int().nonnegative().optional(),
    input: z.array(promptInputSchema).min(1).optional(),
    /** Context persisted on the fork start but hidden from user-facing output. */
    agentContextSeed: z.array(agentOnlyPromptInputSchema).min(1).optional(),
    title: z.string().min(1).optional(),
    permissionMode: permissionModeInputSchema.optional(),
    visibility: threadVisibilitySchema.default("visible"),
    workspace: z.enum(["isolated", "reuse"]).default("isolated"),
    origin: threadCreateOriginSchema.default("sdk"),
    originPluginId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.origin === "plugin" && value.originPluginId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: 'originPluginId is required when origin is "plugin"',
        path: ["originPluginId"],
      });
    }
    if (value.origin !== "plugin" && value.originPluginId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: 'originPluginId requires origin "plugin"',
        path: ["originPluginId"],
      });
    }
  });
export type ForkThreadRequest = z.infer<typeof forkThreadRequestSchema>;

export const sendMessageRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeInputSchema.optional(),
  executionInputSources: existingThreadExecutionInputSourcesSchema.optional(),
  mode: sendMessageModeSchema,
  senderThreadId: z.string().min(1).optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const editMessageRequestSchema = sendMessageRequestSchema
  .omit({ mode: true })
  .extend({
    operationId: z.string().min(1),
    /** Omission targets the latest editable message with no staleness guard. */
    expectedRequestSequence: z.number().int().nonnegative().optional(),
  })
  .strict();
export type EditMessageRequest = z.infer<typeof editMessageRequestSchema>;

export const editMessageResponseSchema = z
  .object({
    ok: z.literal(true),
    operationId: z.string().min(1),
    requestSequence: z.number().int().nonnegative(),
  })
  .strict();
export type EditMessageResponse = z.infer<typeof editMessageResponseSchema>;

export const sendQueuedMessageModeSchema = z.enum(["auto", "steer"]);
export type SendQueuedMessageMode = z.infer<typeof sendQueuedMessageModeSchema>;

export const createQueuedMessageRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeInputSchema.optional(),
  executionInputSources: existingThreadExecutionInputSourcesSchema.optional(),
  senderThreadId: z.string().min(1).optional(),
});
export type CreateQueuedMessageRequest = z.infer<
  typeof createQueuedMessageRequestSchema
>;

export const updateQueuedMessageRequestSchema = z.object({
  expectedUpdatedAt: z.number().int().nonnegative(),
  input: z.array(promptInputSchema).min(1),
});
export type UpdateQueuedMessageRequest = z.infer<
  typeof updateQueuedMessageRequestSchema
>;

export const sendQueuedMessageRequestSchema = z.object({
  mode: sendQueuedMessageModeSchema,
});
export type SendQueuedMessageRequest = z.infer<
  typeof sendQueuedMessageRequestSchema
>;

export const reorderQueuedMessageRequestSchema = z.object({
  previousQueuedMessageId: z.string().min(1).nullable(),
  nextQueuedMessageId: z.string().min(1).nullable(),
  groupBoundaryQueuedMessageId: z.string().min(1).optional(),
});
export type ReorderQueuedMessageRequest = z.infer<
  typeof reorderQueuedMessageRequestSchema
>;

export const setQueuedMessageGroupBoundaryRequestSchema = z.object({
  expectedGroupedPrefixQueuedMessageIds: z.array(z.string().min(1)).min(1),
  groupBoundaryQueuedMessageId: z.string().min(1),
});
export type SetQueuedMessageGroupBoundaryRequest = z.infer<
  typeof setQueuedMessageGroupBoundaryRequestSchema
>;

export const sendQueuedMessageResponseSchema = z.object({
  ok: z.literal(true),
  queuedMessage: threadQueuedMessageSchema,
});
export type SendQueuedMessageResponse = z.infer<
  typeof sendQueuedMessageResponseSchema
>;

export const threadListResponseSchema = z.array(threadListEntrySchema);
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;

export const THREAD_MENTION_RESOLVE_MAX_IDS = 32;

export const resolveThreadMentionsRequestSchema = z
  .object({
    threadIds: z.array(rawThreadIdSchema).max(THREAD_MENTION_RESOLVE_MAX_IDS),
  })
  .strict();
export type ResolveThreadMentionsRequest = z.infer<
  typeof resolveThreadMentionsRequestSchema
>;

export const threadMentionResolutionSchema = z
  .object({
    threadId: rawThreadIdSchema,
    projectId: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();
export type ThreadMentionResolution = z.infer<
  typeof threadMentionResolutionSchema
>;

export const resolveThreadMentionsResponseSchema = z.array(
  threadMentionResolutionSchema,
);
export type ResolveThreadMentionsResponse = z.infer<
  typeof resolveThreadMentionsResponseSchema
>;

export const threadSearchHighlightRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.end > range.start, {
    message: "highlight range end must be greater than start",
  });
export type ThreadSearchHighlightRange = z.infer<
  typeof threadSearchHighlightRangeSchema
>;

export const threadSearchMatchSchema = z
  .object({
    sourceKind: threadSearchSourceKindSchema,
    // Title matches carry the whole title. Message matches carry a bounded
    // snippet around the first hit (an ellipsis marks each cut side), and the
    // highlight ranges are offsets into that snippet.
    text: z.string(),
    highlightRanges: z.array(threadSearchHighlightRangeSchema),
    // Event sequence of the message this match came from, so the UI can deep-link
    // to it in the conversation. Null for title/title_fallback matches.
    sourceSeq: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ThreadSearchMatch = z.infer<typeof threadSearchMatchSchema>;

export const threadSearchResultSchema = z
  .object({
    thread: threadListEntrySchema,
    matches: z.array(threadSearchMatchSchema),
  })
  .strict();
export type ThreadSearchResult = z.infer<typeof threadSearchResultSchema>;

export const threadSearchResultGroupSchema = z
  .object({
    total: z.number().int().nonnegative(),
    results: z.array(threadSearchResultSchema),
  })
  .strict();
export type ThreadSearchResultGroup = z.infer<
  typeof threadSearchResultGroupSchema
>;

export const threadSearchResponseSchema = z
  .object({
    active: threadSearchResultGroupSchema,
    archived: threadSearchResultGroupSchema,
  })
  .strict();
export type ThreadSearchResponse = z.infer<typeof threadSearchResponseSchema>;

// canSpawnChild is a server-derived policy flag: true when the thread's
// hierarchy depth is below MAX_THREAD_HIERARCHY_DEPTH, so a fork/side-chat may
// be created under it. Computed on the server so clients never recompute the
// depth cap.
export const threadResponseSchema = threadWithRuntimeSchema.extend({
  activeBackgroundAgentCount: z.number().int().nonnegative(),
  canSpawnChild: z.boolean(),
});
export type ThreadResponse = z.infer<typeof threadResponseSchema>;

export const threadIncludeOptionSchema = z.enum(["environment", "host"]);
export type ThreadIncludeOption = z.infer<typeof threadIncludeOptionSchema>;

export const threadGetQuerySchema = z.object({
  include: z
    .string()
    .min(1)
    .refine(
      (value) =>
        isCommaSeparatedIncludeQueryValue({
          allowedValues: threadIncludeOptionSchema.options,
          value,
        }),
      { message: "Invalid include" },
    )
    .optional(),
});
export type ThreadGetQuery = z.infer<typeof threadGetQuerySchema>;

export const threadWithIncludesResponseSchema = threadResponseSchema.extend({
  environment: environmentSchema.nullable().optional(),
  host: hostSchema.nullable().optional(),
});
export type ThreadWithIncludesResponse = z.infer<
  typeof threadWithIncludesResponseSchema
>;

export const threadPendingInteractionsResponseSchema = z.array(
  pendingInteractionSchema,
);
export type ThreadPendingInteractionsResponse = z.infer<
  typeof threadPendingInteractionsResponseSchema
>;

export const resolvePendingInteractionRequestSchema =
  pendingInteractionResolutionSchema;
export type ResolvePendingInteractionRequest = z.infer<
  typeof resolvePendingInteractionRequestSchema
>;

export const respondPluginInteractionRequestSchema = z.object({
  value: jsonValueSchema,
});
export type RespondPluginInteractionRequest = z.infer<
  typeof respondPluginInteractionRequestSchema
>;

export const threadQueuedMessageListResponseSchema = z.array(
  threadQueuedMessageSchema,
);
export type ThreadQueuedMessageListResponse = z.infer<
  typeof threadQueuedMessageListResponseSchema
>;

export const threadChildSummaryResponseSchema = z.object({
  nonDeletedChildCount: z.number().int().nonnegative(),
});
export type ThreadChildSummaryResponse = z.infer<
  typeof threadChildSummaryResponseSchema
>;

export const deleteThreadRequestSchema = z.object({
  childThreadsConfirmed: z.boolean(),
});
export type DeleteThreadRequest = z.infer<typeof deleteThreadRequestSchema>;

export const updateThreadRequestSchema = z
  .object({
    title: z.string().min(1).nullable(),
    sectionId: z.string().min(1).nullable(),
    parentThreadId: z.string().min(1).nullable(),
    // Sticky thread-level execution overrides applied on the next turn. `null`
    // clears the override; an omitted field is left unchanged. Settable
    // together or independently.
    model: z.string().min(1).nullable(),
    reasoningLevel: reasoningLevelSchema.nullable(),
    visibility: threadVisibilitySchema,
  })
  .partial()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.sectionId !== undefined ||
      value.parentThreadId !== undefined ||
      value.model !== undefined ||
      value.reasoningLevel !== undefined ||
      value.visibility !== undefined,
    "At least one field must be provided",
  );
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

export const reorderPinnedThreadRequestSchema = z.object({
  previousThreadId: z.string().min(1).nullable(),
  nextThreadId: z.string().min(1).nullable(),
});
export type ReorderPinnedThreadRequest = z.infer<
  typeof reorderPinnedThreadRequestSchema
>;

/** Which root a secondary-panel file path is relative to. */
export const panelFileSourceSchema = z.enum(["workspace", "thread-storage"]);
export type PanelFileSource = z.infer<typeof panelFileSourceSchema>;

/**
 * Requested placement for a thread opened in the app's split layout. Edge
 * placements add panes through the eighth pane; at the cap they replace the
 * focused pane. `replace` always replaces the focused pane.
 */
export const threadOpenSplitSchema = z.enum([
  "right",
  "down",
  "left",
  "top",
  "replace",
]);
export type ThreadOpenSplit = z.infer<typeof threadOpenSplitSchema>;

/** Optional secondary-panel file to open with a thread. */
export const threadOpenFileSchema = z
  .object({
    source: panelFileSourceSchema,
    path: z.string().min(1),
    lineNumber: z.number().int().positive().nullable(),
  })
  .strict();
export type ThreadOpenFile = z.infer<typeof threadOpenFileSchema>;

const threadOpenFileLenientSchema = z.object({
  source: panelFileSourceSchema,
  path: z.string().min(1),
  lineNumber: z.number().int().positive().nullable(),
});

/**
 * Ephemeral server→client WebSocket message asking connected clients to open a
 * thread in the current split layout and, optionally, a file in that thread's
 * secondary panel. Broadcast to every client; nothing is persisted. Strict
 * schema guards the server's outgoing boundary.
 */
export const threadOpenSignalSchema = z
  .object({
    type: z.literal("thread-open"),
    projectId: z.string().min(1),
    threadId: z.string().min(1),
    split: threadOpenSplitSchema,
    file: threadOpenFileSchema.nullable(),
  })
  .strict();
export type ThreadOpenSignal = z.infer<typeof threadOpenSignalSchema>;

/**
 * Lenient counterpart for INBOUND parsing on clients (the web app), tolerant of
 * a newer server. Output stays assignable to {@link ThreadOpenSignal}.
 */
export const threadOpenSignalLenientSchema = z.object({
  type: z.literal("thread-open"),
  projectId: z.string(),
  threadId: z.string(),
  split: threadOpenSplitSchema,
  file: threadOpenFileLenientSchema.nullable(),
});

/** Request body for POST /threads/:id/open (threadId comes from the path). */
export const threadOpenRequestSchema = z
  .object({
    // Omission preserves ordinary thread/file-open behavior, while an explicit
    // placement lets callers choose how the pane should open.
    split: threadOpenSplitSchema.optional(),
    file: threadOpenFileSchema.nullable(),
  })
  .strict();
export type ThreadOpenRequest = z.infer<typeof threadOpenRequestSchema>;

/** Response for POST /threads/:id/open: how many connected clients received it. */
export const threadOpenResponseSchema = z.object({
  delivered: z.number().int().nonnegative(),
});
export type ThreadOpenResponse = z.infer<typeof threadOpenResponseSchema>;

/** Presentation action for one thread pane in each connected app window. */
export const threadPaneActionSchema = z.enum([
  "maximize",
  "restore",
  "toggle",
  "spotlight",
  "clear-spotlight",
]);
export type ThreadPaneAction = z.infer<typeof threadPaneActionSchema>;

/** Request body for POST /threads/:id/pane-action. */
export const threadPaneActionRequestSchema = z
  .object({ action: threadPaneActionSchema })
  .strict();
export type ThreadPaneActionRequest = z.infer<
  typeof threadPaneActionRequestSchema
>;

/** Ephemeral server→client request to change an already-open thread pane. */
export const threadPaneActionSignalSchema = z
  .object({
    type: z.literal("thread-pane-action"),
    projectId: z.string().min(1),
    threadId: z.string().min(1),
    action: threadPaneActionSchema,
  })
  .strict();
export type ThreadPaneActionSignal = z.infer<
  typeof threadPaneActionSignalSchema
>;

/** Lenient inbound parser for clients connected to a newer server. */
export const threadPaneActionSignalLenientSchema = z.object({
  type: z.literal("thread-pane-action"),
  projectId: z.string(),
  threadId: z.string(),
  action: threadPaneActionSchema,
});

/** Number of connected app clients that received the pane action. */
export const threadPaneActionResponseSchema = z.object({
  delivered: z.number().int().nonnegative(),
});
export type ThreadPaneActionResponse = z.infer<
  typeof threadPaneActionResponseSchema
>;

export const threadArchiveAllResponseSchema = z.object({
  ok: z.literal(true),
  archivedThreadIds: z.array(z.string().min(1)),
});
export type ThreadArchiveAllResponse = z.infer<
  typeof threadArchiveAllResponseSchema
>;

export const threadListQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  parentThreadId: z.string().min(1).optional(),
  sourceThreadId: z.string().min(1).optional(),
  archived: z.enum(["true", "false"]).optional(),
  /** Restrict to threads filed directly under this section. */
  sectionId: z.string().min(1).optional(),
  /** Restrict to loose threads — those not filed under any section. */
  unsectioned: z.enum(["true", "false"]).optional(),
  /** Filter by parent thread presence: "true" means child threads; "false" means root threads. */
  hasParent: z.enum(["true", "false"]).optional(),
  /** Restrict to threads spawned with this origin. */
  originKind: threadOriginKindSchema.optional(),
  /** Restrict to threads spawned by this plugin. */
  originPluginId: z.string().min(1).optional(),
  /** Include hidden threads; omitted/false keeps the default visible-only list. */
  includeHidden: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;

export const threadSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limitPerGroup: z.string().regex(/^\d+$/).optional(),
});
export type ThreadSearchQuery = z.infer<typeof threadSearchQuerySchema>;

export const timelinePaginationCursorSchema = z
  .object({
    anchorSeq: z.number().int().positive(),
    anchorId: z.string().min(1),
  })
  .strict();
export type TimelinePaginationCursor = z.infer<
  typeof timelinePaginationCursorSchema
>;

export const timelinePageMetadataSchema = z
  .object({
    kind: z.enum(["latest", "older"]),
    segmentLimit: z.number().int().positive(),
    returnedSegmentCount: z.number().int().nonnegative(),
    hasOlderRows: z.boolean(),
    olderCursor: timelinePaginationCursorSchema.nullable(),
  })
  .strict();

export const threadTimelineQuerySchema = z
  .object({
    /**
     * When `"true"`, completed turns carry their child rows inline and every
     * command/tool row carries its full inline output (bounded by the 32 K
     * inline cap). The default window collapses completed turns and replaces
     * the running turn's large outputs with a head+tail preview marked by
     * `outputPreview`; read those whole via `timelineTurnSummaryDetails`.
     */
    includeNestedRows: z.enum(["true", "false"]),
    segmentLimit: z.string().regex(/^\d+$/),
    beforeAnchorSeq: z.string().regex(/^[1-9]\d*$/),
    beforeAnchorId: z.string().min(1),
    /**
     * When `"true"`, the response omits row generation and returns
     * `rows: []` with the tail-only fields (`activeThinking`,
     * `activeWorkflows`, `pendingTodos`, `contextWindowUsage`) populated
     * normally. Used by the CLI to read tail state without paying for the full
     * row payload on every `bb status` invocation. Implies `latest` page
     * semantics.
     */
    summaryOnly: z.enum(["true", "false"]),
    /**
     * The `maxSeq` the client last received for this window. When provided and
     * the server can still reconstruct what the client holds, the response is a
     * `delta` (changed rows only) instead of the full `rows`; otherwise the
     * server returns the full window and the client replaces.
     */
    afterSequence: z.string().regex(/^\d+$/),
  })
  .partial()
  .superRefine((query, context) => {
    const hasBeforeAnchorSeq = query.beforeAnchorSeq !== undefined;
    const hasBeforeAnchorId = query.beforeAnchorId !== undefined;

    if (hasBeforeAnchorSeq === hasBeforeAnchorId) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "beforeAnchorSeq and beforeAnchorId must be provided together",
      path: hasBeforeAnchorSeq ? ["beforeAnchorId"] : ["beforeAnchorSeq"],
    });
  });
export type ThreadTimelineQuery = z.infer<typeof threadTimelineQuerySchema>;

export const timelineTurnSummaryDetailsQuerySchema = z.object({
  turnId: z.string().min(1),
  sourceSeqStart: z.string().regex(/^\d+$/),
  sourceSeqEnd: z.string().regex(/^\d+$/),
});
export type TimelineTurnSummaryDetailsQuery = z.infer<
  typeof timelineTurnSummaryDetailsQuerySchema
>;

export const threadEventsQuerySchema = z
  .object({
    afterSeq: z.string().regex(/^\d+$/),
    beforeSeq: z.string().regex(/^\d+$/),
    limit: z.string().regex(/^\d+$/),
    order: z.enum(["asc", "desc"]),
    types: z.string().refine(
      (value) =>
        isCommaSeparatedIncludeQueryValue({
          allowedValues: threadEventTypeValues,
          value,
        }),
      "Invalid thread event types",
    ),
  })
  .partial();
export type ThreadEventsQuery = z.infer<typeof threadEventsQuerySchema>;

export const threadEventWaitQuerySchema = z.object({
  type: z.string().min(1),
  afterSeq: z.string().regex(/^\d+$/).optional(),
  waitMs: z.string().regex(/^\d+$/).optional(),
});
export type ThreadEventWaitQuery = z.infer<typeof threadEventWaitQuerySchema>;

export const threadStorageFilesQuerySchema = z
  .object({
    query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH),
    limit: z.string().regex(/^\d+$/),
  })
  .partial();
export type ThreadStorageFilesQuery = z.infer<
  typeof threadStorageFilesQuerySchema
>;

export const threadStoragePathsQuerySchema =
  threadStorageFilesQuerySchema.extend({
    includeFiles: pathListIncludeQueryValueSchema,
    includeDirectories: pathListIncludeQueryValueSchema,
  });
export type ThreadStoragePathsQuery = z.infer<
  typeof threadStoragePathsQuerySchema
>;

export const threadStorageContentQuerySchema = z.object({
  path: z.string().min(1),
});
export type ThreadStorageContentQuery = z.infer<
  typeof threadStorageContentQuerySchema
>;

export const threadHostFileContentQuerySchema = z.object({
  path: z.string().min(1),
});
export type ThreadHostFileContentQuery = z.infer<
  typeof threadHostFileContentQuerySchema
>;

export const threadFilesRawQuerySchema = z.object({
  /** Absolute filesystem path of an HTML file on the thread's host. */
  path: z.string().min(1),
});
export type ThreadFilesRawQuery = z.infer<typeof threadFilesRawQuerySchema>;

export const timelineTurnSummaryDetailsRequestSchema = z.object({
  turnId: z.string().min(1),
  sourceSeqStart: z.number().int().nonnegative(),
  sourceSeqEnd: z.number().int().nonnegative(),
});
export type TimelineTurnSummaryDetailsRequest = z.infer<
  typeof timelineTurnSummaryDetailsRequestSchema
>;

export const timelineTurnSummaryDetailsResponseSchema = z.object({
  rows: z.array(timelineRowSchema),
});
export type TimelineTurnSummaryDetailsResponse = z.infer<
  typeof timelineTurnSummaryDetailsResponseSchema
>;

export const threadTimelineResponseSchema = z.object({
  rows: z.array(timelineRowSchema),
  activePromptMode: threadTimelineActivePromptModeSchema.nullable(),
  activeThinking: activeThinkingSchema.nullable(),
  /** Running workflows, most recently started first. */
  activeWorkflows: z.array(timelineWorkflowWorkRowSchema),
  activeBackgroundCommands: z.array(timelineWorkflowWorkRowSchema),
  pendingTodos: threadTimelinePendingTodosSchema.nullable(),
  goal: threadTimelineGoalSchema.nullable(),
  modelFallback: threadTimelineModelFallbackSchema.nullable(),
  contextWindowUsage: threadContextWindowUsageSchema.optional(),
  timelinePage: timelinePageMetadataSchema,
  /** Thread high-water event sequence this window reflects; bumps on append. */
  maxSeq: z.number().int().nonnegative(),
  /**
   * Present only when the request supplied a usable `afterSequence`: the
   * changed rows + ordering to apply to the client's previous window. When
   * present, `rows` is empty and the client merges via `applyTimelineDelta`.
   */
  delta: timelineDeltaSchema.optional(),
});
export type ThreadTimelineResponse = z.infer<
  typeof threadTimelineResponseSchema
>;

/**
 * Lightweight attachment counts for a conversation-outline item. The full
 * {@link timelineConversationAttachmentsSchema} carries image URLs and file
 * paths the outline never renders, so the outline ships only the counts the
 * minimap needs to label an attachment-only message.
 */
export const threadConversationOutlineAttachmentSummarySchema = z
  .object({
    imageCount: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
  })
  .strict();
export type ThreadConversationOutlineAttachmentSummary = z.infer<
  typeof threadConversationOutlineAttachmentSummarySchema
>;

/**
 * A single conversation message in the thread's full table-of-contents
 * outline. `id` matches the corresponding timeline row id (both are projected
 * by the same builder), so the minimap can scroll-spy and jump to a row once
 * it is paginated into the loaded window. `preview` is already whitespace-
 * normalized and length-clamped server-side to keep the payload small for
 * very long threads.
 */
export const threadConversationOutlineItemSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    preview: z.string(),
    attachmentSummary:
      threadConversationOutlineAttachmentSummarySchema.nullable(),
  })
  .strict();
export type ThreadConversationOutlineItem = z.infer<
  typeof threadConversationOutlineItemSchema
>;

export const threadConversationOutlineResponseSchema = z
  .object({
    items: z.array(threadConversationOutlineItemSchema),
    /** Thread high-water event sequence this outline reflects. */
    maxSeq: z.number().int().nonnegative(),
  })
  .strict();
export type ThreadConversationOutlineResponse = z.infer<
  typeof threadConversationOutlineResponseSchema
>;

export const threadStorageFileListResponseSchema =
  workspaceFileListResponseSchema.extend({
    /**
     * Absolute on-host path to the thread's storage directory. Useful for
     * clients that need to construct a full path for filesystem operations
     * (e.g. opening a storage file in the user's editor). The path is on
     * the thread's host machine, so it is only usable when that host is the
     * user's local machine.
     */
    storageRootPath: z.string(),
  });
export type ThreadStorageFileListResponse = z.infer<
  typeof threadStorageFileListResponseSchema
>;

export const threadStoragePathListResponseSchema =
  workspacePathListResponseSchema.extend({
    /**
     * Absolute on-host path to the thread's storage directory. Useful for
     * clients that need to construct a full path for filesystem operations
     * (e.g. opening a storage file in the user's editor). The path is on
     * the thread's host machine, so it is only usable when that host is the
     * user's local machine.
     */
    storageRootPath: z.string(),
  });
export type ThreadStoragePathListResponse = z.infer<
  typeof threadStoragePathListResponseSchema
>;
