import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

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
