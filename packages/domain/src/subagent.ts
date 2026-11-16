import { z } from "zod";

export const threadSubagentStatusValues = [
  "running",
  "completed",
  "cancelled",
  "failed",
] as const;
export const threadSubagentStatusSchema = z.enum(threadSubagentStatusValues);
export type ThreadSubagentStatus = z.infer<typeof threadSubagentStatusSchema>;

export const threadSubagentProgressSchema = z.object({
  durationMs: z.number().nonnegative().optional(),
  turnCount: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  tokensUsed: z.number().nonnegative().optional(),
});
export type ThreadSubagentProgress = z.infer<
  typeof threadSubagentProgressSchema
>;

export const threadSubagentSchema = z.object({
  childRef: z.string().min(1),
  parentToolCallId: z.string().min(1),
  label: z.string().min(1),
  subagentType: z.string().min(1),
  model: z.string().min(1).optional(),
  status: threadSubagentStatusSchema,
  progress: threadSubagentProgressSchema.optional(),
  result: z.string().optional(),
  error: z.string().optional(),
});
export type ThreadSubagent = z.infer<typeof threadSubagentSchema>;

export const threadSubagentMessageResultSchema = z.object({
  childRef: z.string().min(1),
  messageId: z.string().min(1),
});
export type ThreadSubagentMessageResult = z.infer<
  typeof threadSubagentMessageResultSchema
>;

export const threadSubagentCancelResultSchema = z.object({
  childRef: z.string().min(1),
  status: z.literal("cancelled"),
});
export type ThreadSubagentCancelResult = z.infer<
  typeof threadSubagentCancelResultSchema
>;
