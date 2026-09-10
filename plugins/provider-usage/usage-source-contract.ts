import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const accountFields = {
  accountEmail: z.string().nullable(),
  planLabel: z.string().nullable(),
};
const usageWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  usedPercent: z
    .number()
    .nonnegative()
    .describe("Percentage consumed; may exceed 100 for overage."),
  resetsAt: z
    .string()
    .nullable()
    .describe("ISO timestamp, or null when no reset is known."),
  model: z
    .string()
    .nullable()
    .describe("Applicable model family, or null for all models."),
  cost: z
    .object({
      usedUsdCents: z.number().nonnegative(),
      limitUsdCents: z.number().positive(),
    })
    .nullable(),
});
const usageSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    ...accountFields,
    windows: z.array(usageWindowSchema),
  }),
  z.object({ status: z.literal("not_installed"), ...accountFields }),
  z.object({ status: z.literal("unauthenticated"), ...accountFields }),
  z.object({ status: z.literal("expired"), ...accountFields }),
  z.object({
    status: z.literal("error"),
    ...accountFields,
    message: z.string(),
  }),
]);
export const usageSnapshotSchema = z.object({
  resources: z.array(
    z.object({
      id: z
        .string()
        .min(1)
        .describe("Stable resource ID within the reporting plugin."),
      providerId: z.string().min(1),
      label: z.string().min(1),
      scope: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("shared") }),
        z.object({
          kind: z.literal("host"),
          hostId: z.string().min(1),
          hostName: z.string().min(1),
        }),
      ]),
      observedAt: z
        .number()
        .int()
        .nonnegative()
        .nullable()
        .describe(
          "Measurement time in epoch milliseconds; null if never observed.",
        ),
      usage: usageSchema,
    }),
  ),
});
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;
export const usageInputSchema = z.object({
  refresh: z
    .boolean()
    .describe(
      "Request fresh collection and wait for the attempt; false permits cached observations.",
    ),
});

export const usageSourceMethod = "provider-usage.v1.get";
export const usageSourceRpcContract = defineRpcContract({
  [usageSourceMethod]: {
    input: usageInputSchema,
    output: usageSnapshotSchema,
    experimental_description:
      "Returns a complete snapshot of this source's usage resources. Resource IDs are stable within the source plugin. Host resources belong to one machine; shared resources appear once across machines. refresh=true waits for a fresh collection attempt. Return per-resource failures when possible; observedAt records the last successful measurement, never the fetch time. Consumers discover implementations by this method name and validate responses against their local contract copy.",
  },
});
