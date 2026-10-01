import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const diskUsageInputSchema = z
  .object({
    targets: z
      .array(
        z.object({ path: z.string().min(1), perChild: z.boolean() }).strict(),
      )
      .min(1)
      .max(500),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(30 * 60_000),
  })
  .strict();
export type DiskUsageInput = z.infer<typeof diskUsageInputSchema>;
export const measuredTargetSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("measured"),
    path: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    children: z
      .array(
        z.object({
          name: z.string(),
          sizeBytes: z.number().int().nonnegative(),
        }),
      )
      .nullable(),
  }),
  z.object({ outcome: z.literal("missing"), path: z.string() }),
]);
export type MeasuredTarget = z.infer<typeof measuredTargetSchema>;
export const diskUsageOutputSchema = z.object({
  targets: z.array(measuredTargetSchema),
});
const storageEntrySchema = z
  .object({
    rootPath: z.string().min(1),
    name: z.string().min(1),
    recreate: z.boolean(),
  })
  .strict();
export const diskCapacitySchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
});
export const hostStorageContract = defineRpcContract({
  measure: { input: diskUsageInputSchema, output: diskUsageOutputSchema },
  capacity: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: diskCapacitySchema,
  },
  discard: {
    input: storageEntrySchema,
    output: z.object({ removed: z.boolean() }),
  },
});
