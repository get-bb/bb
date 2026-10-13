import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const retryAvailabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-routed") }),
  z.object({ kind: z.literal("ready") }),
  z.object({
    kind: z.literal("blocked"),
    retryAt: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("unavailable"),
    reason: z.enum([
      "no-enabled-account",
      "authentication",
      "reset-unknown",
      "source-unavailable",
    ]),
  }),
]);
export type RetryAvailability = z.infer<typeof retryAvailabilitySchema>;
export const retryAvailabilityMethod = "provider-retry.v1.availability";
export const retryAvailabilityContract = defineRpcContract({
  [retryAvailabilityMethod]: {
    input: z.object({
      threadId: z.string().min(1),
      requestId: z.string().min(1),
    }),
    output: retryAvailabilitySchema,
    experimental_description:
      "Availability for a failed request routed through this source. Ready means another attempt can run; blocked gives the earliest known usable account in epoch milliseconds. Unavailable overrides provider-local quota snapshots. Not-routed leaves provider retry policy unchanged.",
  },
});
