import { z } from "zod";

export const managedWorkflowSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    control: z.enum(["running", "pause-requested"]),
    waitFor: z.string().min(1).nullable(),
    wakeAt: z.number().int().nonnegative().nullable(),
    dispatch: z.enum(["pending", "accepted"]).nullable(),
    failureObservedAt: z.number().int().nonnegative().nullable().default(null),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ManagedWorkflow = z.infer<typeof managedWorkflowSchema>;
export const managedRunInputSchema = z
  .object({
    projectId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();
export const managedCheckpointInputSchema = managedRunInputSchema
  .extend({
    threadId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    state: z.enum([
      "running",
      "paused",
      "blocked",
      "succeeded",
      "failed",
      "skipped",
    ]),
    summary: z.string().min(1).max(100_000),
    waitFor: z.string().min(1).nullable().default(null),
    wakeAt: z.number().int().nonnegative().nullable().default(null),
  })
  .strict()
  .refine((value) => value.waitFor === null || value.wakeAt === null, {
    message: "Wait for one child or a clock deadline, not both",
  });
export type ManagedCheckpointInput = z.output<
  typeof managedCheckpointInputSchema
>;
