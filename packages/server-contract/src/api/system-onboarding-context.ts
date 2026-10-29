import { z } from "zod";
import {
  onboardingExperimentKeySchema,
  onboardingTelemetrySourceSchema,
} from "./system-journey-telemetry.js";

export const onboardingStageSchema = z.enum([
  "agent",
  "projects",
  "plugins",
  "devices",
  "first_task",
  "continuation",
]);
export const onboardingContextRequestSchema = z
  .object({
    source: onboardingTelemetrySourceSchema,
    stage: onboardingStageSchema,
  })
  .strict();
export type OnboardingContextRequest = z.infer<
  typeof onboardingContextRequestSchema
>;

export const onboardingAssignmentSchema = z
  .object({
    experiment_key: onboardingExperimentKeySchema,
    experiment_revision: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u),
    variant: z.enum(["control", "candidate"]),
  })
  .strict();
export type OnboardingAssignment = z.infer<typeof onboardingAssignmentSchema>;

export const onboardingContextResponseSchema = z
  .object({
    design_revision: z.literal("baseline"),
    recommendation_revision: z.literal("baseline"),
    assignment: onboardingAssignmentSchema.nullable(),
  })
  .strict();
export type OnboardingContextResponse = z.infer<
  typeof onboardingContextResponseSchema
>;
