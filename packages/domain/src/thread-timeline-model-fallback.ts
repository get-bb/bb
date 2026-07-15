import { z } from "zod";

export const threadTimelineModelFallbackSchema = z.object({
  sourceSeq: z.number().int().nonnegative(),
  detectedAt: z.number(),
  originalModel: z.string().min(1),
  fallbackModel: z.string().min(1),
  reason: z.enum(["refusal", "provider"]),
  message: z.string(),
});
export type ThreadTimelineModelFallback = z.infer<
  typeof threadTimelineModelFallbackSchema
>;
