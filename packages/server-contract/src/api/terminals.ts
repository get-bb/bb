import { z } from "zod";
import {
  terminalColsSchema,
  terminalDataBase64Schema,
  terminalRowsSchema,
  terminalSessionCloseReasonSchema,
  terminalSessionStatusSchema,
} from "@bb/domain";

export const terminalSessionSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  environmentId: z.string().min(1),
  hostId: z.string().min(1),
  title: z.string().min(1),
  initialCwd: z.string().min(1),
  cols: terminalColsSchema,
  rows: terminalRowsSchema,
  status: terminalSessionStatusSchema,
  exitCode: z.number().int().nullable(),
  closeReason: terminalSessionCloseReasonSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastUserInputAt: z.number().int().nonnegative().nullable(),
});
export type TerminalSession = z.infer<typeof terminalSessionSchema>;

export const threadTerminalListResponseSchema = z.object({
  sessions: z.array(terminalSessionSchema),
});
export type ThreadTerminalListResponse = z.infer<
  typeof threadTerminalListResponseSchema
>;

export const createThreadTerminalRequestSchema = z
  .object({
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
    title: z.string().trim().min(1).max(200).optional(),
    start: z
      .discriminatedUnion("mode", [
        z
          .object({
            mode: z.literal("shell"),
          })
          .strict(),
        z
          .object({
            mode: z.literal("command"),
            command: z.string().trim().min(1).max(10_000),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();
export type CreateThreadTerminalRequest = z.infer<
  typeof createThreadTerminalRequestSchema
>;

export const closeThreadTerminalRequestSchema = z
  .object({
    mode: z.enum(["force", "if-clean"]),
    reason: z.literal("user"),
  })
  .strict();
export type CloseThreadTerminalRequest = z.infer<
  typeof closeThreadTerminalRequestSchema
>;

export const updateThreadTerminalRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type UpdateThreadTerminalRequest = z.infer<
  typeof updateThreadTerminalRequestSchema
>;

export const terminalOutputChunkSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    dataBase64: terminalDataBase64Schema,
  })
  .strict();
export type TerminalOutputChunk = z.infer<typeof terminalOutputChunkSchema>;

export const terminalInputRequestSchema = z
  .object({
    dataBase64: terminalDataBase64Schema,
  })
  .strict();
export type TerminalInputRequest = z.infer<typeof terminalInputRequestSchema>;

export const terminalResizeRequestSchema = z
  .object({
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;

export const terminalOutputQuerySchema = z
  .object({
    sinceSeq: z.coerce.number().int().nonnegative().optional(),
    tailBytes: z.coerce
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024)
      .optional(),
    limitChunks: z.coerce.number().int().positive().max(10_000).optional(),
  })
  .strict();
export type TerminalOutputQuery = z.infer<typeof terminalOutputQuerySchema>;

export const terminalOutputResponseSchema = z
  .object({
    chunks: z.array(terminalOutputChunkSchema),
    nextSeq: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type TerminalOutputResponse = z.infer<
  typeof terminalOutputResponseSchema
>;

export const terminalClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("input"),
      dataBase64: terminalDataBase64Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal("resize"),
      cols: terminalColsSchema,
      rows: terminalRowsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("close"),
      reason: z.literal("user"),
    })
    .strict(),
  z
    .object({
      type: z.literal("ping"),
    })
    .strict(),
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export const terminalServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("attached"),
      session: terminalSessionSchema,
      nextSeq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("output"),
      chunk: terminalOutputChunkSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("session-updated"),
      session: terminalSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("exited"),
      session: terminalSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("pong"),
    })
    .strict(),
]);
export type TerminalServerMessage = z.infer<typeof terminalServerMessageSchema>;
