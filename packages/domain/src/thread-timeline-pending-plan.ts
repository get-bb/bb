import { z } from "zod";
import { threadEventPlanStepStatusSchema } from "./provider-event.js";

/**
 * Snapshot of the latest structured provider plan observed by the timeline
 * projection. Tail-only state on the thread timeline response: present on
 * `latest` page requests while the thread is active, null otherwise.
 */
export const threadTimelinePendingPlanStepSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: threadEventPlanStepStatusSchema,
});
export type ThreadTimelinePendingPlanStep = z.infer<
  typeof threadTimelinePendingPlanStepSchema
>;

export const threadTimelinePendingPlanSchema = z.object({
  sourceSeq: z.number().int().nonnegative(),
  updatedAt: z.number(),
  explanation: z.string().nullable(),
  steps: z.array(threadTimelinePendingPlanStepSchema),
});
export type ThreadTimelinePendingPlan = z.infer<
  typeof threadTimelinePendingPlanSchema
>;
