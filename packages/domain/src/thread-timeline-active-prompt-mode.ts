import { z } from "zod";

export const threadTimelineActivePromptModeSchema = z
  .object({
    mode: z.literal("plan"),
    providerId: z.literal("claude-code"),
  })
  .strict();

export type ThreadTimelineActivePromptMode = z.infer<
  typeof threadTimelineActivePromptModeSchema
>;
