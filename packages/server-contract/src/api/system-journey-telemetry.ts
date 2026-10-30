import { z } from "zod";

export const onboardingTelemetrySourceSchema = z.enum([
  "first_run",
  "replay",
  "settings",
  "cli",
  "other",
  "unknown",
]);

export const onboardingBlockerReasonSchema = z.enum([
  "agent_missing",
  "agent_update",
  "sign_in",
  "provider_selection",
  "model_selection",
  "model_unavailable",
  "machine_unavailable",
  "project_setup",
  "other",
]);

export const onboardingAgentDiagnosticPropertiesSchema = z
  .object({
    source: onboardingTelemetrySourceSchema,
    state: z.enum([
      "checking",
      "ready",
      "sign_in",
      "signing_in",
      "install",
      "update",
      "installing",
      "install_failed",
      "unknown",
    ]),
    trigger: z.enum(["step_visible", "state_changed"]),
    any_agent_ready: z.boolean().nullable(),
    action_available: z.boolean().nullable(),
  })
  .strict();

export const onboardingProjectStatePropertiesSchema = z
  .object({
    source: onboardingTelemetrySourceSchema,
    action: z.enum(["scan_result", "folder_opened", "folder_result"]),
    result: z.enum([
      "empty",
      "nonempty",
      "selected",
      "cancelled",
      "failed",
      "unknown",
    ]),
    selection: z.enum(["none", "some", "unknown"]),
  })
  .strict()
  .superRefine((value, context) => {
    const validResult = {
      scan_result: ["empty", "nonempty", "failed", "unknown"],
      folder_opened: ["unknown"],
      folder_result: ["selected", "cancelled", "failed", "unknown"],
    }[value.action].includes(value.result);
    if (!validResult) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "Result must describe the observed project action",
      });
    }
  });

export const newThreadBlockerPropertiesSchema = z
  .object({
    state: z.enum(["shown", "cleared"]),
    reason: onboardingBlockerReasonSchema,
    source: onboardingTelemetrySourceSchema,
  })
  .strict();

export const onboardingJourneyTelemetrySchemas = [
  z
    .object({
      name: z.literal("onboarding_agent_diagnostic"),
      properties: onboardingAgentDiagnosticPropertiesSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("onboarding_project_state"),
      properties: onboardingProjectStatePropertiesSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("new_thread_blocker"),
      properties: newThreadBlockerPropertiesSchema,
    })
    .strict(),
] as const;

export type OnboardingTelemetrySource = z.infer<
  typeof onboardingTelemetrySourceSchema
>;
export type OnboardingBlockerReason = z.infer<
  typeof onboardingBlockerReasonSchema
>;
