import { z } from "zod";

export const threadTimelineActivePromptModeSchema = z
  .object({
    mode: z.literal("plan"),
    /**
     * Any provider id. Eligibility is not this field's job: it comes from the
     * provider declaring a `plan` composer action, so a plugin provider that
     * declares one gets plan mode. This used to be `z.enum(["claude-code",
     * "codex"])`, which made plan mode structurally unreachable for anyone
     * else.
     */
    providerId: z.string().min(1),
    prompt: z.string(),
  })
  .strict();

export type ThreadTimelineActivePromptMode = z.infer<
  typeof threadTimelineActivePromptModeSchema
>;
