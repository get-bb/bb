import { z } from "zod";

export const usagePlanSchema = z.object({
  id: z.string().min(1),
  multiplier: z.number().int().positive().nullable(),
});
const accountFields = {
  plan: usagePlanSchema.nullable().default(null),
  accountEmail: z.string().nullable(),
  planLabel: z.string().nullable(),
};
export const usageWindowKindSchema = z.enum([
  "five-hour",
  "daily",
  "weekly",
  "custom",
]);
const usageWindowSchema = z.object({
  kind: usageWindowKindSchema.default("custom"),
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
export const usageAccountKeySchema = z
  .string()
  .min(1)
  .nullable()
  .default(null)
  .describe(
    "Provider-issued quota account identity, namespaced by issuer and account/organization scope. Never use email, a display label, a source-local ID, or credentials. Null means unknown; unknown accounts must not be merged.",
  );
export const usageResourceSchema = z.object({
  accountKey: usageAccountKeySchema,
  id: z
    .string()
    .min(1)
    .describe("Stable resource ID within this source plugin."),
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
});
export const usageResourceListSchema = z.object({
  label: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Declares a shared group even when empty. Host-only sources omit it; machine groups use host names.",
    ),
  resources: z.array(usageResourceSchema),
});
export const usageMeasurementSchema = z.object({
  accountKey: usageAccountKeySchema,
  observedAt: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe(
      "Last successful measurement time in epoch milliseconds; null if never observed.",
    ),
  usage: usageSchema,
});
export const usageListInputSchema = z.object({});
export const usageFetchInputSchema = z.object({
  resourceId: z.string().min(1),
  refresh: z
    .boolean()
    .describe(
      "False permits a cached measurement but still returns actual usage. True requests a fresh collection attempt for this resource only.",
    ),
});
export type UsageResourceList = z.infer<typeof usageResourceListSchema>;
export type UsageMeasurement = z.infer<typeof usageMeasurementSchema>;
export type UsageResource = z.infer<typeof usageResourceSchema> &
  UsageMeasurement;
export const usageListMethod = "provider-usage.v1.listResources";
export const usageFetchMethod = "provider-usage.v1.getResource";
