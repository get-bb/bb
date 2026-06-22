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
  threadId: z.string().min(1).nullable(),
  environmentId: z.string().min(1).nullable(),
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

export const terminalListResponseSchema = z.object({
  sessions: z.array(terminalSessionSchema),
});
export type TerminalListResponse = z.infer<typeof terminalListResponseSchema>;

export const threadTerminalListResponseSchema = terminalListResponseSchema;
export type ThreadTerminalListResponse = z.infer<
  typeof threadTerminalListResponseSchema
>;

export const environmentTerminalListResponseSchema = terminalListResponseSchema;
export type EnvironmentTerminalListResponse = z.infer<
  typeof environmentTerminalListResponseSchema
>;

export const terminalCreateTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("environment"),
      environmentId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("host_path"),
      hostId: z.string().min(1),
      cwd: z.string().trim().min(1).nullable(),
    })
    .strict(),
]);
export type TerminalCreateTarget = z.infer<typeof terminalCreateTargetSchema>;

export const createTerminalRequestSchema = z
  .object({
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
    target: terminalCreateTargetSchema,
  })
  .strict();
export type CreateTerminalRequest = z.infer<typeof createTerminalRequestSchema>;

export const createScopedTerminalRequestSchema = z
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

export const createThreadTerminalRequestSchema =
  createScopedTerminalRequestSchema;
export type CreateThreadTerminalRequest = z.infer<
  typeof createThreadTerminalRequestSchema
>;

export const createEnvironmentTerminalRequestSchema =
  createScopedTerminalRequestSchema;
export type CreateEnvironmentTerminalRequest = z.infer<
  typeof createEnvironmentTerminalRequestSchema
>;

export const closeTerminalRequestSchema = z
  .object({
    mode: z.enum(["force", "if-clean"]),
    reason: z.literal("user"),
  })
  .strict();
export type CloseTerminalRequest = z.infer<typeof closeTerminalRequestSchema>;

export const closeThreadTerminalRequestSchema = closeTerminalRequestSchema;
export type CloseThreadTerminalRequest = z.infer<
  typeof closeThreadTerminalRequestSchema
>;

export const closeEnvironmentTerminalRequestSchema =
  closeTerminalRequestSchema;
export type CloseEnvironmentTerminalRequest = z.infer<
  typeof closeEnvironmentTerminalRequestSchema
>;

export const updateTerminalRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type UpdateTerminalRequest = z.infer<typeof updateTerminalRequestSchema>;

export const updateThreadTerminalRequestSchema = updateTerminalRequestSchema;
export type UpdateThreadTerminalRequest = z.infer<
  typeof updateThreadTerminalRequestSchema
>;

export const updateEnvironmentTerminalRequestSchema =
  updateTerminalRequestSchema;
export type UpdateEnvironmentTerminalRequest = z.infer<
  typeof updateEnvironmentTerminalRequestSchema
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
