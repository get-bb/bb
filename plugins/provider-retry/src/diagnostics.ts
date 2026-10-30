import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { retryAvailabilitySchema, retryConsentSchema } from "./retry-contract.js";

const senderConsentSchema = z.object({
  pluginId: z.string(),
  answer: z.union([
    retryConsentSchema,
    z.object({ kind: z.literal("unanswered") }),
  ]),
});
export type SenderConsent = z.infer<typeof senderConsentSchema>;

export const retryDiagnosticSchema = z.object({
  requestId: z.string(),
  observedAt: z.number(),
  availability: retryAvailabilitySchema,
  decision: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("decline"), reason: z.string() }),
    z.object({
      kind: z.literal("retry"),
      reason: z.string(),
      sendAt: z.number(),
    }),
  ]),
  consent: senderConsentSchema.nullable().default(null),
});
export type RetryDiagnostic = z.infer<typeof retryDiagnosticSchema>;
export const retryDiagnosticContract = defineRpcContract({
  "decision.get": {
    input: z.object({ threadId: z.string().min(1) }),
    output: retryDiagnosticSchema.nullable(),
  },
});
export async function readRetryDiagnostic(
  bb: BbPluginApi,
  threadId: string,
): Promise<RetryDiagnostic | null> {
  return retryDiagnosticSchema
    .nullable()
    .parse((await bb.storage.kv.get(`decision:${threadId}`)) ?? null);
}
