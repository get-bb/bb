import { z } from "zod";
import {
  activeThinkingSchema,
  callerExecutionInputSourceSchema,
  environmentSchema,
  hostSchema,
  pendingInteractionResolutionSchema,
  pendingInteractionSchema,
  permissionModeSchema,
  promptInputSchema,
  reasoningLevelSchema,
  resolvedThreadExecutionOptionsSchema,
  serviceTierSchema,
  threadChildOriginSchema,
  threadOriginKindSchema,
  threadListEntrySchema,
  threadQueuedMessageSchema,
  threadSearchSourceKindSchema,
  threadTimelineActivePromptModeSchema,
  threadTimelineGoalSchema,
  threadTimelinePendingTodosSchema,
  threadWithRuntimeSchema,
} from "@bb/domain";
import type { CallerExecutionInputSource } from "@bb/domain";
import {
  timelineDeltaSchema,
  timelineRowSchema,
  timelineWorkflowWorkRowSchema,
} from "../thread-timeline.js";
import {
  environmentArgsSchema,
  FILE_LIST_QUERY_MAX_LENGTH,
  isCommaSeparatedIncludeQueryValue,
  pathListIncludeQueryValueSchema,
  threadContextWindowUsageSchema,
  workspaceFileListResponseSchema,
  workspacePathListResponseSchema,
} from "./shared.js";
import { promptHistoryResponseSchema } from "./projects.js";
import { systemExecutionOptionsResponseSchema } from "./system.js";

export const sendMessageModeSchema = z.enum([
  "queue-if-active",
  "steer-if-active",
  "auto",
  "start",
  "steer",
]);

export const threadCreateOriginSchema = z.enum([
  "app",
  "cli",
  "automation",
  "sdk",
]);
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
    title: z.string().min(1).optional(),
    // A source-derived side-chat preload may establish the cloned provider
    // session without a first prompt. Normal starts and forks require at least
    // one input entry, enforced by the refinement below rather than a blanket
    // `.min(1)`.
    input: z.array(promptInputSchema),
    model: z.string().min(1).optional(),
    serviceTier: serviceTierSchema.optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
    executionInputSources: createExecutionInputSourcesSchema.optional(),
    environment: environmentArgsSchema,
    parentThreadId: z.string().min(1).optional(),
    folderId: z.string().min(1).nullable().optional(),
    sourceThreadId: z.string().min(1).optional(),
    sourceSeqEnd: z.number().int().nonnegative().optional(),
    startedOnBehalfOf: startedOnBehalfOfSchema.nullable().default(null),
    originKind: threadOriginKindSchema.nullable().default(null),
    /** @deprecated Use originKind. */
    childOrigin: threadChildOriginSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    const originKind = value.originKind ?? value.childOrigin;
    if (originKind === null && value.input.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "input must contain at least one entry",
        path: ["input"],
      });
    }
    if (originKind === "fork" && value.input.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "fork input must contain at least one entry",
        path: ["input"],
      });
    }
    if (originKind === null && value.sourceSeqEnd !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "sourceSeqEnd requires an originKind",
        path: ["sourceSeqEnd"],
      });
    }
  });
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export const sendMessageRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  executionInputSources: existingThreadExecutionInputSourcesSchema.optional(),
  mode: sendMessageModeSchema,
  senderThreadId: z.string().min(1).optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendQueuedMessageModeSchema = z.enum(["auto", "steer"]);
export type SendQueuedMessageMode = z.infer<typeof sendQueuedMessageModeSchema>;

export const createQueuedMessageRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  executionInputSources: existingThreadExecutionInputSourcesSchema.optional(),
  senderThreadId: z.string().min(1).optional(),
});
export type CreateQueuedMessageRequest = z.infer<
  typeof createQueuedMessageRequestSchema
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
    text: z.string(),
    highlightRanges: z.array(threadSearchHighlightRangeSchema),
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
    folderId: z.string().min(1).nullable(),
    parentThreadId: z.string().min(1).nullable(),
    // Sticky thread-level execution overrides applied on the next turn. `null`
    // clears the override; an omitted field is left unchanged. Settable
    // together or independently.
    model: z.string().min(1).nullable(),
    reasoningLevel: reasoningLevelSchema.nullable(),
  })
  .partial()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.folderId !== undefined ||
      value.parentThreadId !== undefined ||
      value.model !== undefined ||
      value.reasoningLevel !== undefined,
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
 * Ephemeral server→client WebSocket message asking connected clients to open a
 * file in the secondary panel of the given thread. Broadcast to every client;
 * each opens it immediately if it is viewing the thread, otherwise when the
 * thread is next viewed. Nothing is persisted. Strict schema guards the
 * server's outgoing boundary (mirrors {@link terminalServerMessageSchema}).
 */
export const threadOpenFileSignalSchema = z
  .object({
    type: z.literal("thread-open-file"),
    threadId: z.string().min(1),
    source: panelFileSourceSchema,
    path: z.string().min(1),
    lineNumber: z.number().int().positive().nullable(),
  })
  .strict();
export type ThreadOpenFileSignal = z.infer<typeof threadOpenFileSignalSchema>;

/**
 * Lenient counterpart for INBOUND parsing on clients (the web app), tolerant of
 * a newer server. Output stays assignable to {@link ThreadOpenFileSignal}.
 */
export const threadOpenFileSignalLenientSchema = z.object({
  type: z.literal("thread-open-file"),
  threadId: z.string(),
  source: panelFileSourceSchema,
  path: z.string(),
  lineNumber: z.number().int().positive().nullable(),
});

/** Request body for POST /threads/:id/open (threadId comes from the path). */
export const threadOpenRequestSchema = z.object({
  source: panelFileSourceSchema,
  path: z.string().min(1),
  lineNumber: z.number().int().positive().nullable(),
});
export type ThreadOpenRequest = z.infer<typeof threadOpenRequestSchema>;

/** Response for POST /threads/:id/open: how many connected clients received it. */
export const threadOpenResponseSchema = z.object({
  delivered: z.number().int().nonnegative(),
});
export type ThreadOpenResponse = z.infer<typeof threadOpenResponseSchema>;

/** @deprecated Compatibility shape for clients that still call composer bootstrap. */
export const threadComposerBootstrapResponseSchema = z.object({
  defaultExecutionOptions: resolvedThreadExecutionOptionsSchema.nullable(),
  queuedMessages: threadQueuedMessageListResponseSchema,
  executionOptions: systemExecutionOptionsResponseSchema.nullable(),
  pendingInteractions: threadPendingInteractionsResponseSchema,
  promptHistory: promptHistoryResponseSchema,
});
export type ThreadComposerBootstrapResponse = z.infer<
  typeof threadComposerBootstrapResponseSchema
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
  /** Restrict to threads filed directly under this folder. */
  folderId: z.string().min(1).optional(),
  /** Restrict to loose threads — those not filed under any folder. */
  unfiled: z.enum(["true", "false"]).optional(),
  /** Filter by parent thread presence: "true" means child threads; "false" means root threads. */
  hasParent: z.enum(["true", "false"]).optional(),
  /** Restrict to threads spawned with this origin (fork or side-chat). */
  originKind: threadOriginKindSchema.optional(),
  /** Exclude source-derived side-chat threads. */
  excludeSideChats: z.enum(["true", "false"]).optional(),
  /** @deprecated Use originKind. */
  childOrigin: threadChildOriginSchema.optional(),
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
    includeNestedRows: z.enum(["true", "false"]),
    segmentLimit: z.string().regex(/^\d+$/),
    beforeAnchorSeq: z.string().regex(/^[1-9]\d*$/),
    beforeAnchorId: z.string().min(1),
    /**
     * When `"true"`, the response omits row generation and returns
     * `rows: []` with the tail-only fields (`activeThinking`,
     * `activeWorkflow`, `pendingTodos`, `contextWindowUsage`) populated
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
    limit: z.string().regex(/^\d+$/),
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
  activeWorkflow: timelineWorkflowWorkRowSchema.nullable(),
  activeBackgroundCommands: z.array(timelineWorkflowWorkRowSchema),
  pendingTodos: threadTimelinePendingTodosSchema.nullable(),
  goal: threadTimelineGoalSchema.nullable(),
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
