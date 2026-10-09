import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { retryAvailabilitySchema } from "./retry-contract.js";

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
