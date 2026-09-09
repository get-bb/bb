import { z } from "zod";

export const threadTimelineProviderAuthRequiredSchema = z.object({
  sourceSeq: z.number().int().nonnegative(),
});
export type ThreadTimelineProviderAuthRequired = z.infer<
  typeof threadTimelineProviderAuthRequiredSchema
>;
