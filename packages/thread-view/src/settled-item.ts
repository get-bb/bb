import { z } from "zod";
import {
  threadEventItemPresentationSchema,
  threadEventScopeSchema,
} from "@bb/domain";
import type { SettledItemMessage } from "./event-projection-message.js";

const intentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("read"),
    cmd: z.string(),
    name: z.string(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("list_files"),
    cmd: z.string(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("search"),
    cmd: z.string(),
    query: z.string().nullable(),
    path: z.string().nullable(),
  }),
  z.object({ type: z.literal("unknown"), cmd: z.string() }),
]);

const baseSchema = z.strictObject({
  id: z.string().min(1),
  threadId: z.string().min(1),
  scope: threadEventScopeSchema,
  sourceSeqStart: z.number().int().positive(),
  sourceSeqEnd: z.number().int().positive(),
  createdAt: z.number().finite(),
  startedAt: z.number().finite().optional(),
  parentToolCallId: z.string().optional(),
});
const statusSchema = z.enum(["completed", "error", "interrupted"]);
const approvalSchema = z.enum(["waiting_for_approval", "denied"]).nullable();
const messageSchema = z.discriminatedUnion("kind", [
  baseSchema.extend({
    kind: z.literal("command"),
    callId: z.string().min(1),
    completedAt: z.number().finite(),
    command: z.string(),
    cwd: z.string().nullable(),
    parsedIntents: z.array(intentSchema),
    source: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    approvalStatus: approvalSchema,
    status: statusSchema,
    presentation: threadEventItemPresentationSchema.optional(),
    output: z.string(),
  }),
  baseSchema.extend({
    kind: z.literal("assistant-text"),
    text: z.string(),
    status: z.literal("completed"),
    isLegacyUserMessage: z.literal(false).optional(),
  }),
  baseSchema.extend({
    kind: z.literal("file-edit"),
    callId: z.string().min(1),
    changes: z.array(
      z.strictObject({
        path: z.string(),
        kind: z.string().optional(),
        movePath: z.string().nullable().optional(),
        diff: z.string().optional(),
      }),
    ),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    approvalStatus: approvalSchema,
    status: statusSchema,
    presentation: threadEventItemPresentationSchema.optional(),
  }),
  baseSchema.extend({
    kind: z.literal("operation"),
    opType: z.literal("reasoning"),
    title: z.string(),
    detail: z.string().optional(),
    status: z.literal("completed"),
    completedAt: z.number().finite(),
  }),
]);
const outputRetentionSchema = z.strictObject({
  originalLength: z.number().finite(),
  retainedHeadLength: z.number().finite(),
  retainedTailLength: z.number().finite(),
  truncatedAt: z.number().finite(),
});
type OutputRetention = z.infer<typeof outputRetentionSchema>;
const settledItemSchema = z
  .strictObject({
    version: z.literal(1),
    message: messageSchema,
    outputRetention: outputRetentionSchema.optional(),
    toolFlushSequences: z.array(z.number().int().positive()).optional(),
  })
  .refine(
    (value) =>
      value.message.sourceSeqEnd >= value.message.sourceSeqStart &&
      (value.outputRetention === undefined ||
        value.message.kind === "command") &&
      (value.toolFlushSequences ?? []).every(
        (sequence) =>
          sequence >= value.message.sourceSeqStart &&
          sequence <= value.message.sourceSeqEnd,
      ),
  );

export function encodeSettledItem(
  message: SettledItemMessage,
  outputRetention?: OutputRetention,
  toolFlushSequences?: number[],
): string {
  return JSON.stringify(
    settledItemSchema.parse({
      version: 1,
      message,
      ...(outputRetention ? { outputRetention } : {}),
      ...(toolFlushSequences?.length ? { toolFlushSequences } : {}),
    }),
  );
}

export function decodeSettledItem(data: string): SettledItemMessage {
  return settledItemSchema.parse(JSON.parse(data)).message;
}

export function decodeSettledItemRecord(data: string) {
  return settledItemSchema.parse(JSON.parse(data));
}
