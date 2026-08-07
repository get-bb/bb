import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const providerRetryPhaseSchema = z.enum([
  "waiting-for-reset",
  "waiting-for-host",
  "manual-only",
  "retry-failed",
  "releasing",
  "blocked",
]);
export type ProviderRetryPhase = z.infer<typeof providerRetryPhaseSchema>;

export const providerRetryViewSchema = z
  .object({
    threadId: z.string().min(1),
    failedRequestId: z.string().min(1).nullable(),
    scopeKey: z.string().min(1),
    hostId: z.string().min(1),
    providerId: z.string().min(1),
    phase: providerRetryPhaseSchema,
    automatic: z.boolean(),
    dueAtMs: z.number().int().nonnegative().nullable(),
    resetsAtMs: z.number().int().nonnegative().nullable(),
    windowLabel: z.string().min(1).nullable(),
    kind: z.string().min(1),
    reachedReason: z.string().min(1).nullable(),
    overageReason: z.string().min(1).nullable(),
    recoveryReason: z.string().min(1),
    continuationError: z.string().min(1).nullable(),
    refreshError: z.string().min(1).nullable(),
  })
  .strict();
export type ProviderRetryView = z.infer<typeof providerRetryViewSchema>;

const threadInput = z.object({ threadId: z.string().min(1) }).strict();

export const providerRetryRpcContract = defineRpcContract({
  providerRetryStatus: {
    input: threadInput,
    output: z.object({ view: providerRetryViewSchema.nullable() }).strict(),
  },
  providerRetryNow: {
    input: threadInput,
    output: z
      .object({
        started: z.boolean(),
        view: providerRetryViewSchema.nullable(),
      })
      .strict(),
  },
  providerRetryCancel: {
    input: threadInput,
    output: z.object({ cancelled: z.boolean() }).strict(),
  },
});
