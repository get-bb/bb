/**
 * Zod schemas for the subset of the Agent Client Protocol (ACP) that BB
 * consumes — https://agentclientprotocol.com. The bridge validates agent
 * traffic with these before forwarding, and the adapter re-validates the
 * `update` payloads it translates into thread events.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

/**
 * The ACP tool-call kind vocabulary (protocol v1 `ToolKind`); an absent kind
 * reads as `other`.
 */
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

/**
 * The tool-call status vocabulary: the four v1 statuses plus the v2 draft's
 * `cancelled`, which settles the call as interrupted.
 */
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

/**
 * A tool call's content list, one entry at a time: an entry of a type this
 * schema does not know (the v2 draft adds an open `Other` content variant)
 * is skipped, and the call keeps the entries it does know. A closed list
 * here would drop the whole call for one foreign entry.
 */
const acpToolCallContentListSchema = z
  .array(z.unknown())
  .transform((entries) =>
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

/**
 * The unstable programmatic tool name (ACP 1.6.0, `unstable_tool_call_name`).
 * A `null` leaves the name unchanged, so it reads as absent.
 */
const acpToolCallNameSchema = z
  .union([z.string(), z.null()])
  .transform((value) => value ?? undefined)
  .optional();

/**
 * The parsed tool-call fields. `kind` and `status` are the normalized
 * vocabularies above; `rawKind` is the agent's own kind when it was not one
 * of them (see `openAcpToolCallEnums`). `_meta` stays an opaque passthrough
 * field: vendor side channels are read by the per-agent dialect, never by
 * this shared schema.
 */
const acpToolCallFieldsSchema = z.object({
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

/**
 * Open the tool-call enums at the wire boundary. ACP's `ToolKind` is an open
 * enum upstream (`#[serde(other)]`; the v2 draft adds `Unknown(String)` and
 * an open status), so an agent may send a `kind` or `status` this schema has
 * never seen, and some agents serialize an absent optional as `null`. A
 * closed enum here rejected the whole `tool_call`, so the call never opened
 * and its later `completed` update merged into nothing — the row was lost.
 * Now an unknown kind parses as `other` with the raw value kept on
 * `rawKind` (it names the generic tool slot), an unknown status parses as
 * `pending`, and a `null` reads as absent.
 */
function openAcpToolCallEnums(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  // Freeform agent traffic: narrowed field by field below.
  const fields = value as Record<string, unknown>;
  const { kind, status, ...rest } = fields;
  const next: Record<string, unknown> = rest;
  if (typeof kind === "string") {
    if (ACP_TOOL_KIND_SET.has(kind)) {
      next["kind"] = kind;
    } else {
      next["kind"] = "other";
      next["rawKind"] = kind;
    }
  } else if (kind !== undefined && kind !== null) {
    next["kind"] = kind;
  }
  if (typeof status === "string") {
    next["status"] = ACP_TOOL_CALL_STATUS_SET.has(status) ? status : "pending";
  } else if (status !== undefined && status !== null) {
    next["status"] = status;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Session updates (`session/update` notification payloads)
// ---------------------------------------------------------------------------

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

export const acpToolCallUpdateEventSchema = z.preprocess(
  openAcpToolCallEnums,
  acpToolCallFieldsSchema
    .extend({
      sessionUpdate: z.enum(["tool_call", "tool_call_update"]),
    })
    .passthrough(),
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

// ---------------------------------------------------------------------------
// Initialization & sessions
// ---------------------------------------------------------------------------

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

/**
 * Some ACP agents serialize an absent optional string as an explicit `null`
 * instead of omitting the key — pi-acp does this for every model and
 * config-option `description`. Accept both forms and normalize to `undefined`
 * so downstream code sees a single shape.
 */
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
    parsedOptions.push({
      id: loose.data.id,
      ...(typeof loose.data.name === "string" ? { name: loose.data.name } : {}),
      ...(loose.data.category !== undefined
        ? { category: loose.data.category }
        : {}),
      type: typeof loose.data.type === "string" ? loose.data.type : "",
      ...(typeof loose.data.currentValue === "string"
        ? { currentValue: loose.data.currentValue }
        : {}),
      ...(Array.isArray(loose.data.options)
        ? {
            options: loose.data.options.flatMap((selectOption) => {
              const parsed =
                acpConfigOptionSelectOptionSchema.safeParse(selectOption);
              return parsed.success ? [parsed.data] : [];
            }),
          }
        : {}),
    });
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

// ---------------------------------------------------------------------------
// Client-bound requests (agent → client)
// ---------------------------------------------------------------------------

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
    toolCall: z
      .preprocess(
        openAcpToolCallEnums,
        acpToolCallFieldsSchema.partial().passthrough(),
      )
      .optional(),
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
