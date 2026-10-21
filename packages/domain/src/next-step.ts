import { z } from "zod";

export const nextStepKindSchema = z.enum([
  "task",
  "automation",
  "plugin",
  "skill",
]);
export const nextStepEvidenceSourceSchema = z.enum([
  "conversation",
  "file",
  "commit",
  "ci_run",
  "issue",
  "pull_request",
]);
export const nextStepEvidenceSchema = z
  .object({
    source: nextStepEvidenceSourceSchema,
    ref: z.string().trim().min(1).max(2048),
    excerpt: z.string().max(200).optional(),
  })
  .strict();
export type NextStepEvidence = z.infer<typeof nextStepEvidenceSchema>;

export const nextStepActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("task"),
      task: z
        .object({
          prompt: z.string().trim().min(1).max(32_000),
          parallel: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("automation"),
      automation: z
        .object({
          prompt: z.string().trim().min(1).max(32_000),
          schedule: z
            .object({
              runAt: z.number().int().positive().max(8_640_000_000_000_000),
              timezone: z
                .string()
                .min(1)
                .max(100)
                .refine((value) => {
                  try {
                    new Intl.DateTimeFormat("en", { timeZone: value }).format();
                    return true;
                  } catch {
                    return false;
                  }
                }, "Use a valid IANA timezone"),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
]);
export const nextStepInputSchema = z
  .object({
    title: z.string().trim().min(1).max(70),
    why: z.string().trim().min(1).max(140),
    evidence: z.array(nextStepEvidenceSchema).min(1).max(20),
    action: nextStepActionSchema,
  })
  .strict();
export type NextStepInput = z.infer<typeof nextStepInputSchema>;

export const nextStepResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("task"),
      threadIds: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({ kind: z.literal("automation"), automationId: z.string().min(1) })
    .strict(),
]);
export type NextStepResult = z.infer<typeof nextStepResultSchema>;
export const nextStepStatusSchema = z.enum([
  "pending",
  "proposed",
  "accepting",
  "accepted",
  "dismissed",
  "expired",
  "undoing",
  "undone",
]);
export const nextStepSchema = nextStepInputSchema.extend({
  id: z.string().min(1),
  analyticsId: z.string().uuid(),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  status: nextStepStatusSchema,
  createdAt: z.number(),
  shownAt: z.number().nullable(),
  result: nextStepResultSchema.nullable(),
});
export type NextStep = z.infer<typeof nextStepSchema>;
