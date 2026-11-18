import { z } from "zod";

export const serverSweepFailureSchema = z
  .object({
    sweep: z.string(),
    itemKey: z.string(),
    attempts: z.number().int().positive(),
    firstFailedAt: z.number().int(),
    lastError: z.string(),
    retryAt: z.number().int(),
    needsRecovery: z.boolean(),
  })
  .strict();
export type ServerSweepFailure = z.infer<typeof serverSweepFailureSchema>;

export const serverSweepFailuresResponseSchema = z
  .object({ failures: z.array(serverSweepFailureSchema) })
  .strict();
export type ServerSweepFailuresResponse = z.infer<
  typeof serverSweepFailuresResponseSchema
>;

export const serverSweepRetryResponseSchema = z
  .object({ retried: z.number().int().nonnegative() })
  .strict();
export type ServerSweepRetryResponse = z.infer<
  typeof serverSweepRetryResponseSchema
>;
