import { z } from "zod";

export const ompAdvisorPayloadSchema = z.object({
  advisor: z.string().min(1),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  output: z.string().nullable(),
  notes: z.array(
    z.object({
      note: z.string().min(1),
      severity: z.string().min(1).optional(),
    }),
  ),
});

export const ompAdvisorExtensionKinds = {
  advisor: { item: ompAdvisorPayloadSchema },
} as const;
