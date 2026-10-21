import { z } from "zod";

export const setupJobArmSchema = z.enum(["a", "b"]);
export type SetupJobArm = z.infer<typeof setupJobArmSchema>;

export const setupJobTimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (timezone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Choose a valid time zone" },
  );

export const setupJobOfferSchema = z.object({
  arm: setupJobArmSchema,
  suggestionAnalyticsId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  providerName: z.string(),
  timezone: setupJobTimezoneSchema,
  status: z.enum(["offered", "accepted", "dismissed"]),
  automationId: z.string().nullable(),
});
export type SetupJobOffer = z.infer<typeof setupJobOfferSchema>;

export const setupJobDecisionRequestSchema = z
  .object({
    suggestionAnalyticsId: z.uuid(),
    accepted: z.boolean(),
  })
  .strict();
export type SetupJobDecisionRequest = z.infer<
  typeof setupJobDecisionRequestSchema
>;

export const setupJobReadQuerySchema = z.object({
  timezone: setupJobTimezoneSchema.default("UTC"),
});
export type SetupJobReadQuery = z.input<typeof setupJobReadQuerySchema>;
export const setupJobShownRequestSchema = z
  .object({
    suggestionAnalyticsId: z.uuid(),
  })
  .strict();
export const setupJobResponseSchema = z.object({
  offer: setupJobOfferSchema.nullable(),
});
export type SetupJobResponse = z.infer<typeof setupJobResponseSchema>;
