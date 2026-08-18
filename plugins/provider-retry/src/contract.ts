import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const providerRetryViewSchema = z
  .object({
    threadId: z.string().min(1),
    providerId: z.string().min(1),
    retryAtMs: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ProviderRetryView = z.infer<typeof providerRetryViewSchema>;

const threadInput = z.object({ threadId: z.string().min(1) }).strict();

export const providerRetryRpcContract = defineRpcContract({
  providerRetryCancel: {
    input: threadInput,
    output: z.object({ cancelled: z.boolean() }).strict(),
  },
  providerRetryStatus: {
    input: threadInput,
    output: z.object({ view: providerRetryViewSchema.nullable() }).strict(),
  },
});
