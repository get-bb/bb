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
  threadListEntrySchema,
  threadQueuedMessageSchema,
  threadTimelinePendingTodosSchema,
  threadWithRuntimeSchema,
  workflowProgressSnapshotSchema,
} from "@bb/domain";
import type { CallerExecutionInputSource } from "@bb/domain";
import {
  timelineFeedDetailPartSchema,
  timelineFeedRowSchema,
  timelineRowSchema,
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

export const threadCreateOriginSchema = z.enum(["app", "cli"]);
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

export const createThreadRequestSchema = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1).optional(),
  origin: threadCreateOriginSchema,
  title: z.string().min(1).optional(),
  input: z.array(promptInputSchema).min(1),
  model: z.string().min(1).optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  executionInputSources: createExecutionInputSourcesSchema.optional(),
  environment: environmentArgsSchema,
  parentThreadId: z.string().min(1).optional(),
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
});
export type ReorderQueuedMessageRequest = z.infer<
  typeof reorderQueuedMessageRequestSchema
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

export const threadResponseSchema = threadWithRuntimeSchema;
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

export const threadComposerBootstrapResponseSchema = z.object({
  defaultExecutionOptions: resolvedThreadExecutionOptionsSchema.nullable(),
  queuedMessages: threadQueuedMessageListResponseSchema,
  /**
   * Provider/model options for the thread's composer picker. Null when the
   * server deliberately skips resolving them — for archived or environment-less
   * threads, whose follow-up composer locks the provider and needs no list.
   * Null means "not resolved", distinct from a resolved-but-empty list, so
   * callers must not treat it as a system-wide answer (e.g. don't seed the
   * shared system-execution-options cache with it).
   */
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
  archived: z.enum(["true", "false"]).optional(),
  /** Filter by parent thread presence: "true" means child threads; "false" means root threads. */
  hasParent: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;

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

export const threadTimelineFeedQuerySchema = z
  .object({
    segmentLimit: z.string().regex(/^\d+$/),
    beforeAnchorSeq: z.string().regex(/^[1-9]\d*$/),
    beforeAnchorId: z.string().min(1),
    /**
     * When `"true"`, the feed omits rows and returns only tail-state fields
     * (`activeThinking`, `pendingTodos`, `contextWindowUsage`). Used by CLI
     * status surfaces that do not render timeline rows.
     */
    summaryOnly: z.enum(["true", "false"]),
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
export type ThreadTimelineFeedQuery = z.infer<
  typeof threadTimelineFeedQuerySchema
>;

export const timelineTurnSummaryDetailsQuerySchema = z.object({
  turnId: z.string().min(1),
  sourceSeqStart: z.string().regex(/^\d+$/),
  sourceSeqEnd: z.string().regex(/^\d+$/),
});
export type TimelineTurnSummaryDetailsQuery = z.infer<
  typeof timelineTurnSummaryDetailsQuerySchema
>;

export const timelineWorkOutputDetailQuerySchema = z.object({
  callId: z.string().min(1),
  workKind: z.enum(["command", "tool"]),
  sourceSeqStart: z.string().regex(/^\d+$/),
  sourceSeqEnd: z.string().regex(/^\d+$/),
});
export type TimelineWorkOutputDetailQuery = z.infer<
  typeof timelineWorkOutputDetailQuerySchema
>;

export const timelineRowDetailQuerySchema = z.object({
  sourceSeqStart: z.string().regex(/^\d+$/),
  sourceSeqEnd: z.string().regex(/^\d+$/),
  parts: z
    .string()
    .min(1)
    .superRefine((value, context) => {
      for (const part of value.split(",")) {
        if (timelineFeedDetailPartSchema.safeParse(part).success) {
          continue;
        }
        context.addIssue({
          code: "custom",
          message: `Invalid timeline row detail part: ${part}`,
        });
      }
    }),
});
export type TimelineRowDetailQuery = z.infer<
  typeof timelineRowDetailQuerySchema
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

export const timelineWorkOutputDetailResponseSchema = z.object({
  output: z.string(),
});
export type TimelineWorkOutputDetailResponse = z.infer<
  typeof timelineWorkOutputDetailResponseSchema
>;

export const threadTimelineFeedResponseSchema = z.object({
  threadId: z.string(),
  rows: z.array(timelineFeedRowSchema),
  activeThinking: activeThinkingSchema.nullable(),
  pendingTodos: threadTimelinePendingTodosSchema.nullable(),
  contextWindowUsage: threadContextWindowUsageSchema.optional(),
  timelinePage: timelinePageMetadataSchema,
});
export type ThreadTimelineFeedResponse = z.infer<
  typeof threadTimelineFeedResponseSchema
>;

export const timelineRowDetailResponseSchema = z.object({
  rowKey: z.string(),
  source: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  parts: z.object({
    text: z.string().nullable(),
    output: z.string().nullable(),
    systemDetail: z.string().nullable(),
    fileDiff: z.string().nullable(),
    stdout: z.string().nullable(),
    stderr: z.string().nullable(),
    children: z.array(timelineFeedRowSchema).nullable(),
    workflow: workflowProgressSnapshotSchema.nullable(),
  }),
});
export type TimelineRowDetailResponse = z.infer<
  typeof timelineRowDetailResponseSchema
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
