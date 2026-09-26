import { z } from "zod";
import {
  threadEventItemPresentationSchema,
  threadEventScopeSchema,
} from "@bb/domain";
import type { EventProjectionCommandMessage } from "./event-projection-message.js";

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

const messageSchema = z.strictObject({
  kind: z.literal("command"),
  id: z.string().min(1),
  threadId: z.string().min(1),
  callId: z.string().min(1),
  scope: threadEventScopeSchema,
  sourceSeqStart: z.number().int().positive(),
  sourceSeqEnd: z.number().int().positive(),
  createdAt: z.number().finite(),
  startedAt: z.number().finite().optional(),
  completedAt: z.number().finite(),
  parentToolCallId: z.string().optional(),
  command: z.string(),
  cwd: z.string().nullable(),
  parsedIntents: z.array(intentSchema),
  source: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  approvalStatus: z.enum(["waiting_for_approval", "denied"]).nullable(),
  status: z.enum(["completed", "error", "interrupted"]),
  presentation: threadEventItemPresentationSchema.optional(),
});
const settledCommandSchema = z
  .strictObject({
    version: z.literal(1),
    message: messageSchema.extend({ output: z.string() }),
  })
  .refine(
    (value) => value.message.sourceSeqEnd >= value.message.sourceSeqStart,
  );

export function encodeSettledCommand(
  message: EventProjectionCommandMessage,
): string {
  return JSON.stringify(settledCommandSchema.parse({ version: 1, message }));
}

export function decodeSettledCommand(
  data: string,
): EventProjectionCommandMessage {
  return settledCommandSchema.parse(JSON.parse(data)).message;
}
