import { z } from "zod";

export const claudeFileEditArgsSchema = z
  .object({
    file_path: z.string().optional(),
    path: z.string().optional(),
    old_string: z.string().optional(),
    new_string: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();
export type ClaudeFileEditArgs = z.infer<typeof claudeFileEditArgsSchema>;

export const claudeWebSearchArgsSchema = z
  .object({
    query: z.string().optional(),
  })
  .passthrough();
export type ClaudeWebSearchArgs = z.infer<typeof claudeWebSearchArgsSchema>;

export const claudeWebFetchArgsSchema = z
  .object({
    url: z.string().optional(),
    prompt: z.string().optional(),
  })
  .passthrough();
export type ClaudeWebFetchArgs = z.infer<typeof claudeWebFetchArgsSchema>;

export const messageIdSchema = z.object({
  id: z.string(),
});

export const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

export const claudeToolUseProcessResultSchema = z
  .object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  })
  .passthrough();

export const claudeToolUseResultSchema = z.union([
  claudeToolUseProcessResultSchema,
  z.string(),
]);
export type ClaudeToolUseResult = z.infer<typeof claudeToolUseResultSchema>;

export const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  tool_name: z.string().optional(),
  content: z.unknown(),
  is_error: z.boolean().optional(),
  tool_use_result: claudeToolUseResultSchema.nullish(),
});

export const thinkingBlockSchema = z
  .object({
    type: z.literal("thinking"),
    thinking: z.string(),
  })
  .passthrough();

export const messageContentSchema = z
  .object({
    content: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  })
  .passthrough();
export type ClaudeMessageContentBlock = NonNullable<
  z.infer<typeof messageContentSchema>["content"]
>[number];

export const sdkUsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
  })
  .passthrough();
export type ClaudeSdkUsage = z.infer<typeof sdkUsageSchema>;

export const claudeModelUsageSchema = z.record(
  z.string(),
  z
    .object({
      contextWindow: z.number(),
    })
    .passthrough(),
);

const contentBlockDeltaSchema = z
  .object({
    type: z.literal("content_block_delta"),
    index: z.number(),
    delta: z.union([
      z
        .object({ type: z.literal("text_delta"), text: z.string() })
        .passthrough(),
      z
        .object({ type: z.literal("thinking_delta"), thinking: z.string() })
        .passthrough(),
    ]),
  })
  .passthrough();

const contentBlockStartSchema = z
  .object({
    type: z.literal("content_block_start"),
    index: z.number(),
    content_block: z.union([
      z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
      z
        .object({ type: z.literal("thinking"), thinking: z.string() })
        .passthrough(),
    ]),
  })
  .passthrough();

export const streamEventSchema = z.union([
  contentBlockDeltaSchema,
  contentBlockStartSchema,
]);

export const claudeAssistantMessageErrorSchema = z.enum([
  "authentication_failed",
  "oauth_org_not_allowed",
  "billing_error",
  "rate_limit",
  "invalid_request",
  "server_error",
  "unknown",
  "max_output_tokens",
]);
export type ClaudeAssistantMessageError = z.infer<
  typeof claudeAssistantMessageErrorSchema
>;

export const claudeSdkMessageTypeSchema = z
  .object({
    type: z.enum([
      "assistant",
      "rate_limit_event",
      "result",
      "stream_event",
      "system",
      "user",
    ]),
  })
  .passthrough();

export const claudeSystemMessageSchema = z
  .object({
    type: z.literal("system"),
  })
  .passthrough();

export const claudeApiRetryMessageSchema = claudeSystemMessageSchema
  .extend({
    subtype: z.literal("api_retry"),
    attempt: z.number(),
    max_retries: z.number(),
    retry_delay_ms: z.number(),
    error_status: z.number().nullable(),
    error: claudeAssistantMessageErrorSchema,
  })
  .passthrough();
export type ClaudeApiRetryMessage = z.infer<typeof claudeApiRetryMessageSchema>;

export const claudeStatusSystemMessageSchema = claudeSystemMessageSchema
  .extend({
    subtype: z.literal("status"),
    status: z.string().nullable().optional(),
  })
  .passthrough();

export const claudeCompactBoundarySystemMessageSchema =
  claudeSystemMessageSchema
    .extend({
      subtype: z.literal("compact_boundary"),
    })
    .passthrough();

// -- Background task / workflow messages -------------------------------------
// Shapes mirror @anthropic-ai/claude-agent-sdk sdk.d.ts (SDKTaskStartedMessage
// et al). workflow_progress is intentionally untyped in the SDK; records are
// parsed permissively so CLI additions never fail translation.

const claudeTaskUsageSchema = z
  .object({
    total_tokens: z.number(),
    tool_uses: z.number(),
    duration_ms: z.number(),
  })
  .passthrough();
export type ClaudeTaskUsage = z.infer<typeof claudeTaskUsageSchema>;

export const claudeTaskStartedMessageSchema = claudeSystemMessageSchema
  .extend({
    subtype: z.literal("task_started"),
    task_id: z.string(),
    tool_use_id: z.string().optional(),
    description: z.string(),
    subagent_type: z.string().optional(),
    task_type: z.string().optional(),
    workflow_name: z.string().optional(),
    prompt: z.string().optional(),
    skip_transcript: z.boolean().optional(),
  })
  .passthrough();

export const claudeTaskUpdatedMessageSchema = claudeSystemMessageSchema
  .extend({
    subtype: z.literal("task_updated"),
    task_id: z.string(),
    patch: z
      .object({
        status: z
          .enum([
            "pending",
            "running",
            "completed",
            "failed",
            "killed",
            "paused",
          ])
          .optional(),
        description: z.string().optional(),
        end_time: z.number().optional(),
        total_paused_ms: z.number().optional(),
        error: z.string().optional(),
        is_backgrounded: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const claudeTaskProgressMessageSchema = claudeSystemMessageSchema
  .extend({
    subtype: z.literal("task_progress"),
    task_id: z.string(),
    tool_use_id: z.string().optional(),
    description: z.string(),
    subagent_type: z.string().optional(),
    usage: claudeTaskUsageSchema,
    last_tool_name: z.string().optional(),
    summary: z.string().optional(),
    /**
     * Delta batch of workflow progress records (CLI ≥2.1.160, untyped in the
     * SDK). Elements are parsed individually; unknown record kinds are
     * ignored.
     */
    workflow_progress: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const claudeTaskNotificationMessageSchema = claudeSystemMessageSchema
  .extend({
    subtype: z.literal("task_notification"),
    task_id: z.string(),
    tool_use_id: z.string().optional(),
    status: z.enum(["completed", "failed", "stopped"]),
    output_file: z.string(),
    summary: z.string(),
    usage: claudeTaskUsageSchema.optional(),
    skip_transcript: z.boolean().optional(),
  })
  .passthrough();

export const claudeWorkflowAgentRecordSchema = z
  .object({
    type: z.literal("workflow_agent"),
    index: z.number(),
    label: z.string(),
    /** Raw record state machine value (start/progress/done/error); permissive for forward compat. */
    state: z.string(),
    model: z.string().optional(),
    phaseIndex: z.number().optional(),
    phaseTitle: z.string().optional(),
    agentId: z.string().optional(),
    agentType: z.string().optional(),
    isolation: z.string().optional(),
    queuedAt: z.number().optional(),
    startedAt: z.number().optional(),
    lastProgressAt: z.number().optional(),
    attempt: z.number().optional(),
    lastAttemptReason: z.string().optional(),
    lastToolName: z.string().optional(),
    lastToolSummary: z.string().optional(),
    promptPreview: z.string().optional(),
    resultPreview: z.string().optional(),
    error: z.string().optional(),
    skipped: z.boolean().optional(),
    cached: z.boolean().optional(),
    tokens: z.number().optional(),
    toolCalls: z.number().optional(),
    durationMs: z.number().optional(),
  })
  .passthrough();
export type ClaudeWorkflowAgentRecord = z.infer<
  typeof claudeWorkflowAgentRecordSchema
>;

export const claudeWorkflowPhaseRecordSchema = z
  .object({
    type: z.literal("workflow_phase"),
    index: z.number(),
    title: z.string(),
    kind: z.string().optional(),
  })
  .passthrough();

export const claudeAssistantMessageSchema = z
  .object({
    type: z.literal("assistant"),
    message: z.unknown(),
  })
  .passthrough();
export type ClaudeAssistantMessage = z.infer<
  typeof claudeAssistantMessageSchema
>;

export const claudeAssistantUsageMessageSchema = z
  .object({
    usage: sdkUsageSchema.optional(),
  })
  .passthrough();

export const claudeStreamEventMessageSchema = z
  .object({
    type: z.literal("stream_event"),
    event: z.unknown(),
  })
  .passthrough();
export type ClaudeStreamEventMessage = z.infer<
  typeof claudeStreamEventMessageSchema
>;

export const claudeUserMessageSchema = z
  .object({
    type: z.literal("user"),
    message: z.unknown(),
  })
  .passthrough();
export type ClaudeUserMessage = z.infer<typeof claudeUserMessageSchema>;

export const claudeResultSubtypeSchema = z.enum([
  "success",
  "error_during_execution",
  "error_max_turns",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
]);
export type ClaudeResultSubtype = z.infer<typeof claudeResultSubtypeSchema>;

export const claudeResultMessageSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string(),
    is_error: z.boolean().optional(),
    api_error_status: z.number().nullable().optional(),
    errors: z.array(z.string()).optional(),
    result: z.unknown().optional(),
    usage: z.unknown().optional(),
    modelUsage: z.unknown().optional(),
  })
  .passthrough();
export type ClaudeResultMessage = z.infer<typeof claudeResultMessageSchema>;

const claudeRateLimitInfoSchema = z
  .object({
    status: z.enum(["allowed", "allowed_warning", "rejected"]),
    resetsAt: z.number().optional(),
    rateLimitType: z
      .enum([
        "five_hour",
        "seven_day",
        "seven_day_opus",
        "seven_day_sonnet",
        "overage",
      ])
      .optional(),
    overageStatus: z
      .enum(["allowed", "allowed_warning", "rejected"])
      .optional(),
    overageDisabledReason: z
      .enum([
        "overage_not_provisioned",
        "org_level_disabled",
        "org_level_disabled_until",
        "out_of_credits",
        "seat_tier_level_disabled",
        "member_level_disabled",
        "seat_tier_zero_credit_limit",
        "group_zero_credit_limit",
        "member_zero_credit_limit",
        "org_service_level_disabled",
        "no_limits_configured",
        "fetch_error",
        "unknown",
      ])
      .optional(),
  })
  .passthrough();

export const claudeRateLimitEventSchema = z
  .object({
    type: z.literal("rate_limit_event"),
    rate_limit_info: claudeRateLimitInfoSchema,
  })
  .passthrough();
export type ClaudeRateLimitEvent = z.infer<typeof claudeRateLimitEventSchema>;
