import { threadStatusSchema } from "@bb/domain";
import { z } from "zod";

export const systemLapsedResumeResponseSchema = z.object({
  lapsed: z.boolean(),
  lastActivityAt: z.number().nullable(),
  target: z.object({ threadId: z.string(), projectId: z.string() }).nullable(),
  threads: z.array(
    z.object({
      threadId: z.string(),
      projectId: z.string(),
      title: z.string(),
      status: threadStatusSchema,
      reason: z.enum(["waiting", "finished"]),
    }),
  ),
  suggestionAnalyticsId: z.string().nullable(),
});

export type SystemLapsedResumeResponse = z.infer<
  typeof systemLapsedResumeResponseSchema
>;
