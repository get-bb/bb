import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  getAutomation,
  getLatestAutomationRunForThread,
  type Db,
} from "./data.js";

const retryConsentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow") }),
  z.object({ kind: z.literal("decline"), reason: z.string().min(1) }),
]);
type RetryConsent = z.infer<typeof retryConsentSchema>;

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

export function answerRetryConsent(
  db: Db,
  input: { threadId: string },
): RetryConsent {
  const run = getLatestAutomationRunForThread(db, input.threadId);
  if (run === null || run.trigger !== "schedule") return { kind: "allow" };
  const automation = getAutomation(db, run.automationId);
  if (automation === null || automation.triggerType !== "schedule") {
    return { kind: "allow" };
  }
  return {
    kind: "decline",
    reason: `automation "${automation.name}" runs again on its schedule`,
  };
}
