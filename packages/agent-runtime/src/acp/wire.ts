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

export const acpTextContentBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();
export type AcpTextContentBlock = z.infer<typeof acpTextContentBlockSchema>;

const acpOtherContentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

export const acpContentBlockSchema = z.union([
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

export const acpToolKindSchema = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "other",
]);
export type AcpToolKind = z.infer<typeof acpToolKindSchema>;

export const acpToolCallStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);
export type AcpToolCallStatus = z.infer<typeof acpToolCallStatusSchema>;

export const acpToolCallContentSchema = z.union([
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

export const acpToolCallLocationSchema = z
  .object({
    path: z.string(),
    line: z.number().optional().nullable(),
  })
  .passthrough();

const acpToolCallFieldsSchema = z.object({
  toolCallId: z.string(),
  title: z.string().optional(),
  kind: acpToolKindSchema.optional(),
  status: acpToolCallStatusSchema.optional(),
  content: z.array(acpToolCallContentSchema).optional(),
  locations: z.array(acpToolCallLocationSchema).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});

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

export const acpToolCallUpdateEventSchema = acpToolCallFieldsSchema
  .extend({
    sessionUpdate: z.enum(["tool_call", "tool_call_update"]),
  })
  .passthrough();
export type AcpToolCallUpdateEvent = z.infer<
  typeof acpToolCallUpdateEventSchema
>;

export const acpPlanEntryStatusSchema = z.enum([
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
export type AcpInitializeResult = z.infer<typeof acpInitializeResultSchema>;

export const acpSessionNewResultSchema = z
  .object({
    sessionId: z.string(),
  })
  .passthrough();

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

export const acpPermissionOptionKindSchema = z.enum([
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
]);
export type AcpPermissionOptionKind = z.infer<
  typeof acpPermissionOptionKindSchema
>;

export const acpPermissionOptionSchema = z
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
    toolCall: acpToolCallFieldsSchema.partial().passthrough().optional(),
    options: z.array(acpPermissionOptionSchema).min(1),
  })
  .passthrough();
export type AcpRequestPermissionParams = z.infer<
  typeof acpRequestPermissionParamsSchema
>;

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
