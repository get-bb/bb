import { z } from "zod";

const acpTextContentBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

const acpOtherContentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const acpContentBlockSchema = z.union([
  acpTextContentBlockSchema,
  acpOtherContentBlockSchema,
]);
export type AcpContentBlock = z.infer<typeof acpContentBlockSchema>;

export function extractAcpContentText(
  content: AcpContentBlock | undefined,
): string | undefined {
  if (!content) {
    return undefined;
  }
  const parsed = acpTextContentBlockSchema.safeParse(content);
  return parsed.success ? parsed.data.text : undefined;
}

export const ACP_TOOL_KINDS = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
] as const;
export const acpToolKindSchema = z.enum(ACP_TOOL_KINDS);
export type AcpToolKind = z.infer<typeof acpToolKindSchema>;
const ACP_TOOL_KIND_SET: ReadonlySet<string> = new Set(ACP_TOOL_KINDS);

export const ACP_TOOL_CALL_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const;
const acpToolCallStatusSchema = z.enum(ACP_TOOL_CALL_STATUSES);
export type AcpToolCallStatus = z.infer<typeof acpToolCallStatusSchema>;
const ACP_TOOL_CALL_STATUS_SET: ReadonlySet<string> = new Set(
  ACP_TOOL_CALL_STATUSES,
);

const acpToolCallContentSchema = z.union([
  z
    .object({
      type: z.literal("content"),
      content: acpContentBlockSchema,
    })
    .passthrough(),
  z
    .object({
      type: z.literal("diff"),
      path: z.string(),
      oldText: z.string().nullable().optional(),
      newText: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("terminal"),
      terminalId: z.string(),
    })
    .passthrough(),
]);
export type AcpToolCallContent = z.infer<typeof acpToolCallContentSchema>;

const acpToolCallContentListSchema = z.array(z.unknown()).transform((entries) =>
  entries.flatMap((entry) => {
    const parsed = acpToolCallContentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }),
);

const acpToolCallLocationSchema = z
  .object({
    path: z.string(),
    line: z.number().optional().nullable(),
  })
  .passthrough();

const acpToolCallNameSchema = z
  .union([z.string(), z.null()])
  .transform((value) => value ?? undefined)
  .optional();

const acpToolCallNormalizedFieldsSchema = z.object({
  toolCallId: z.string(),
  title: z.string().optional(),
  name: acpToolCallNameSchema,
  kind: acpToolKindSchema.optional(),
  rawKind: z.string().optional(),
  status: acpToolCallStatusSchema.optional(),
  content: acpToolCallContentListSchema.optional(),
  locations: z.array(acpToolCallLocationSchema).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});

const acpToolCallRawFieldsSchema = z
  .object({
    toolCallId: z.string(),
    title: z.string().optional(),
    name: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    content: z.array(z.unknown()).optional(),
    locations: z.array(acpToolCallLocationSchema).optional(),
    rawInput: z.unknown().optional(),
    rawOutput: z.unknown().optional(),
  })
  .passthrough();
const acpToolCallRawFieldsPartialSchema = acpToolCallRawFieldsSchema.partial();

function normalizeAcpToolCallEnums(
  fields: z.infer<typeof acpToolCallRawFieldsPartialSchema>,
) {
  const next = { ...fields };
  if (fields.kind == null) {
    delete next.kind;
  } else if (ACP_TOOL_KIND_SET.has(fields.kind)) {
    next.kind = fields.kind;
  } else {
    next.kind = "other";
    next.rawKind = fields.kind;
  }
  if (fields.status == null) {
    delete next.status;
  } else if (ACP_TOOL_CALL_STATUS_SET.has(fields.status)) {
    next.status = fields.status;
  } else {
    next.status = "pending";
  }
  return next;
}

export const acpAgentMessageChunkUpdateSchema = z
  .object({
    sessionUpdate: z.literal("agent_message_chunk"),
    content: acpContentBlockSchema,
  })
  .passthrough();

export const acpAgentThoughtChunkUpdateSchema = z
  .object({
    sessionUpdate: z.literal("agent_thought_chunk"),
    content: acpContentBlockSchema,
  })
  .passthrough();

const acpToolCallUpdateEventFieldsSchema = acpToolCallNormalizedFieldsSchema
  .extend({
    sessionUpdate: z.enum(["tool_call", "tool_call_update"]),
  })
  .passthrough();
export const acpToolCallUpdateEventSchema =
  acpToolCallRawFieldsSchema.transform((fields) =>
    acpToolCallUpdateEventFieldsSchema.parse(normalizeAcpToolCallEnums(fields)),
  );

const acpToolCallPartialFieldsSchema = acpToolCallNormalizedFieldsSchema
  .partial()
  .passthrough();
const acpToolCallPartialSchema = acpToolCallRawFieldsPartialSchema.transform(
  (fields) =>
    acpToolCallPartialFieldsSchema.parse(normalizeAcpToolCallEnums(fields)),
);
export type AcpToolCallUpdateEvent = z.infer<
  typeof acpToolCallUpdateEventSchema
>;

const acpPlanEntryStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);

export const acpPlanUpdateSchema = z
  .object({
    sessionUpdate: z.literal("plan"),
    entries: z.array(
      z
        .object({
          content: z.string(),
          status: acpPlanEntryStatusSchema.optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const acpUsageUpdateSchema = z
  .object({
    sessionUpdate: z.literal("usage_update"),
    used: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
  })
  .passthrough();
export type AcpUsageUpdate = z.infer<typeof acpUsageUpdateSchema>;

const acpOtherSessionUpdateSchema = z
  .object({
    sessionUpdate: z.string(),
  })
  .passthrough();

export const acpSessionUpdateSchema = z.union([
  acpAgentMessageChunkUpdateSchema,
  acpAgentThoughtChunkUpdateSchema,
  acpToolCallUpdateEventSchema,
  acpPlanUpdateSchema,
  acpUsageUpdateSchema,
  acpOtherSessionUpdateSchema,
]);
export type AcpSessionUpdate = z.infer<typeof acpSessionUpdateSchema>;

export const acpSessionNotificationParamsSchema = z
  .object({
    sessionId: z.string(),
    update: acpSessionUpdateSchema,
  })
  .passthrough();

export const ACP_PROTOCOL_VERSION = 1;

export const acpInitializeResultSchema = z
  .object({
    protocolVersion: z.number(),
    agentCapabilities: z
      .object({
        loadSession: z.boolean().optional(),
        sessionCapabilities: z
          .object({
            fork: z.object({}).passthrough().nullable().optional(),
          })
          .passthrough()
          .optional(),
        promptCapabilities: z
          .object({
            image: z.boolean().optional(),
            audio: z.boolean().optional(),
            embeddedContext: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    authMethods: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  })
  .passthrough();

const acpOptionalString = z
  .union([z.string(), z.null()])
  .transform((value) => value ?? undefined)
  .optional();

const acpConfigOptionSelectOptionSchema = z
  .object({
    value: z.string(),
    name: acpOptionalString,
  })
  .passthrough();

const acpConfigOptionSchema = z
  .object({
    id: z.string(),
    name: acpOptionalString,
    category: acpOptionalString,
    type: z.string(),
    currentValue: acpOptionalString,
    options: z.array(acpConfigOptionSelectOptionSchema).optional(),
  })
  .passthrough();
export type AcpConfigOption = z.infer<typeof acpConfigOptionSchema>;

const acpSessionModelSchema = z
  .object({
    modelId: z.string(),
    name: acpOptionalString,
    description: acpOptionalString,
  })
  .passthrough();

const acpSessionModelsSchema = z
  .object({
    currentModelId: acpOptionalString,
    availableModels: z.array(acpSessionModelSchema).optional(),
  })
  .passthrough();
export type AcpSessionModels = z.infer<typeof acpSessionModelsSchema>;

const acpLooseConfigOptionSchema = z
  .object({
    id: z.string().optional(),
    name: z.unknown().optional(),
    category: acpOptionalString,
    type: z.unknown().optional(),
    currentValue: z.unknown().optional(),
    options: z.unknown().optional(),
  })
  .passthrough();

function parseAcpConfigOptions(
  options: unknown[] | null | undefined,
  ctx: z.RefinementCtx,
): AcpConfigOption[] | undefined {
  if (options == null) {
    return undefined;
  }
  const parsedOptions: AcpConfigOption[] = [];
  for (const option of options) {
    const loose = acpLooseConfigOptionSchema.safeParse(option);
    if (!loose.success) {
      continue;
    }
    const isModelOption =
      loose.data.category === "model" || loose.data.id === "model";
    if (isModelOption) {
      const strict = acpConfigOptionSchema.safeParse(option);
      if (strict.success) {
        parsedOptions.push(strict.data);
        continue;
      }
      ctx.addIssue({
        code: "custom",
        message: `Invalid ACP model config option: ${strict.error.message}`,
      });
      continue;
    }
    if (loose.data.id === undefined) {
      continue;
    }
    const parsedOption: AcpConfigOption = {
      id: loose.data.id,
      type: z.string().catch("").parse(loose.data.type),
    };
    const name = z.string().safeParse(loose.data.name);
    if (name.success) parsedOption.name = name.data;
    if (loose.data.category !== undefined) {
      parsedOption.category = loose.data.category;
    }
    const currentValue = z.string().safeParse(loose.data.currentValue);
    if (currentValue.success) parsedOption.currentValue = currentValue.data;
    const optionsList = z.array(z.unknown()).safeParse(loose.data.options);
    if (optionsList.success) {
      parsedOption.options = optionsList.data.flatMap((selectOption) => {
        const parsed =
          acpConfigOptionSelectOptionSchema.safeParse(selectOption);
        return parsed.success ? [parsed.data] : [];
      });
    }
    parsedOptions.push(parsedOption);
  }
  return parsedOptions;
}

export const acpSessionNewResultSchema = z
  .object({
    sessionId: z.string(),
    models: acpSessionModelsSchema.optional(),
    configOptions: z
      .array(z.unknown())
      .nullable()
      .optional()
      .transform((options, ctx) => parseAcpConfigOptions(options, ctx)),
  })
  .passthrough();

export const acpConfigStateResultSchema = z
  .object({
    models: acpSessionModelsSchema.optional(),
    configOptions: z
      .array(z.unknown())
      .nullable()
      .optional()
      .transform((options, ctx) => parseAcpConfigOptions(options, ctx)),
  })
  .passthrough();
export type AcpConfigStateResult = z.infer<typeof acpConfigStateResultSchema>;

export const acpSessionForkResultSchema = acpConfigStateResultSchema.extend({
  sessionId: z.string(),
});

export const acpStopReasonSchema = z.enum([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);
export type AcpStopReason = z.infer<typeof acpStopReasonSchema>;

export const acpPromptResultSchema = z
  .object({
    stopReason: acpStopReasonSchema,
  })
  .passthrough();

const acpPermissionOptionKindSchema = z.enum([
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
]);
export type AcpPermissionOptionKind = z.infer<
  typeof acpPermissionOptionKindSchema
>;

const acpPermissionOptionSchema = z
  .object({
    optionId: z.string(),
    name: z.string(),
    kind: acpPermissionOptionKindSchema,
  })
  .passthrough();
export type AcpPermissionOption = z.infer<typeof acpPermissionOptionSchema>;

export const acpRequestPermissionParamsSchema = z
  .object({
    sessionId: z.string(),
    toolCall: acpToolCallPartialSchema.optional(),
    options: z.array(acpPermissionOptionSchema).min(1),
  })
  .passthrough();

export const acpReadTextFileParamsSchema = z
  .object({
    sessionId: z.string(),
    path: z.string(),
    line: z.number().nullable().optional(),
    limit: z.number().nullable().optional(),
  })
  .passthrough();

export const acpWriteTextFileParamsSchema = z
  .object({
    sessionId: z.string(),
    path: z.string(),
    content: z.string(),
  })
  .passthrough();
