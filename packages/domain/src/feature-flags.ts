import { z } from "zod";

export const featureFlagsSchema = z.object({
  placeholder: z.boolean(),
  initiatorTelemetry: z.boolean().default(true),
  appUpdateTelemetry: z.boolean().default(false),
  timelineWindowEventBudget: z.number().int().positive(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const defaultFeatureFlags: FeatureFlags = {
  placeholder: false,
  initiatorTelemetry: true,
  appUpdateTelemetry: false,
  timelineWindowEventBudget: 1_500,
};
