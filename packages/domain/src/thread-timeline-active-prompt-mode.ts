import { z } from "zod";

export const threadTimelineActivePromptModeSchema = z
  .object({
    mode: z.literal("plan"),
    providerId: z.enum(["claude-code", "codex"]),
    prompt: z.string(),
  })
  .strict();

export type ThreadTimelineActivePromptMode = z.infer<
  typeof threadTimelineActivePromptModeSchema
>;
