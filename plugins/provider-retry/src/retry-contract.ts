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

export const retryConsentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow") }),
  z.object({ kind: z.literal("decline"), reason: z.string().min(1) }),
]);
export type RetryConsent = z.infer<typeof retryConsentSchema>;
export const retryConsentMethod = "provider-retry.v1.consent";
export const retryConsentContract = defineRpcContract({
  [retryConsentMethod]: {
    input: z.object({
      threadId: z.string().min(1),
      requestId: z.string().min(1),
      reason: z.enum([
        "Rate limited",
        "Provider overloaded",
        "Provider unavailable",
      ]),
      sendAt: z.number().int().nonnegative(),
    }),
    output: retryConsentSchema,
    experimental_description:
      "Asked of the plugin that sent a failed turn before provider retry re-runs it. Decline when the sender re-runs the work itself; allow leaves the retry scheduled. A missing, failing, or slow answer counts as allow.",
  },
});
