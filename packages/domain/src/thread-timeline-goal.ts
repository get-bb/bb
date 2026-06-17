import { z } from "zod";

export const threadTimelineGoalStatusSchema = z.enum([
  "active",
  "paused",
  "budgetLimited",
  "complete",
]);
export type ThreadTimelineGoalStatus = z.infer<
  typeof threadTimelineGoalStatusSchema
>;

export const threadTimelineGoalSchema = z.object({
  sourceSeq: z.number().int().nonnegative(),
  updatedAt: z.number(),
  objective: z.string(),
  status: threadTimelineGoalStatusSchema,
  tokenBudget: z.number().nullable(),
  tokensUsed: z.number(),
  timeUsedSeconds: z.number(),
});
export type ThreadTimelineGoal = z.infer<typeof threadTimelineGoalSchema>;
