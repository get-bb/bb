import { z } from "zod";

export const featureFlagsSchema = z.object({
  placeholder: z.boolean(),
  initiatorTelemetry: z.boolean().default(true),
  timelineWindowEventBudget: z.number().int().positive(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const defaultFeatureFlags: FeatureFlags = {
  placeholder: false,
  initiatorTelemetry: true,
  timelineWindowEventBudget: 1_500,
};
