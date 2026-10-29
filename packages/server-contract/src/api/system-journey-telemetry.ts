import { z } from "zod";

export const onboardingTelemetrySourceSchema = z.enum([
  "first_run",
  "replay",
  "settings",
  "cli",
  "during_first_thread",
  "after_first_thread",
  "other",
  "unknown",
]);

export const onboardingTelemetryStepSchema = z.enum([
  "agent",
  "projects",
  "plugins",
  "devices",
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

export const onboardingExperimentKeySchema = z.enum([
  "layout",
  "agent_setup",
  "project_setup",
  "plugin_selection",
  "plugin_timing",
  "devices",
  "home_welcome",
  "home_starters",
  "starter_relevance",
  "followups",
]);

export const onboardingComparisonPropertiesSchema = z
  .object({
    phase: z.literal("displayed"),
    experiment_key: onboardingExperimentKeySchema.nullable(),
    experiment_revision: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u)
      .nullable(),
    variant: z.enum(["control", "candidate"]).nullable(),
    design_revision: z.literal("baseline"),
    recommendation_revision: z.literal("baseline"),
    source: onboardingTelemetrySourceSchema,
    stage: z
      .enum([
        "agent",
        "projects",
        "plugins",
        "devices",
        "first_task",
        "continuation",
      ])
      .nullable(),
    width_class: z.enum(["compact", "standard", "wide"]).nullable(),
    height_class: z.enum(["short", "regular"]).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.experiment_key === null
        ? value.experiment_revision !== null || value.variant !== null
        : value.experiment_revision === null ||
          value.variant === null ||
          value.stage === null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Exposure requires a complete server-issued assignment or no experiment",
      });
    }
  });

export const onboardingNavigationPropertiesSchema = z
  .object({
    source: onboardingTelemetrySourceSchema,
    current_step: onboardingTelemetryStepSchema,
    action: z.enum([
      "continue",
      "skip_step",
      "skip_setup",
      "back",
      "select_step",
      "leave",
    ]),
    destination_step: onboardingTelemetryStepSchema.nullable(),
    reason: z.enum([
      "agent_not_ready",
      "explicit_skip",
      "navigation_away",
      "none",
    ]),
  })
  .strict();

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
    trigger: z.enum(["step_visible", "state_changed", "continue_attempt"]),
    provider: z.null(),
    any_agent_ready: z.boolean().nullable(),
    action_available: z.boolean().nullable(),
  })
  .strict();

export const onboardingProjectStatePropertiesSchema = z
  .object({
    source: onboardingTelemetrySourceSchema,
    action: z.enum([
      "scan_result",
      "folder_opened",
      "folder_result",
      "selection_changed",
    ]),
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
      selection_changed: ["selected"],
    }[value.action].includes(value.result);
    if (!validResult) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "Result must describe the observed project action",
      });
    }
    if (value.action === "selection_changed" && value.selection === "unknown") {
      context.addIssue({
        code: "custom",
        path: ["selection"],
        message: "A selection change requires an observed selection",
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

export const onboardingWorkSurfacePropertiesSchema = z
  .object({
    surface: z.enum(["first_task", "continuation"]),
    action: z.enum(["displayed", "welcome_displayed"]),
    entry: z.enum(["completed_guide", "skipped_guide", "other", "unknown"]),
    content_revision: z.literal("baseline").nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.action === "welcome_displayed" &&
      value.content_revision === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["content_revision"],
        message: "Displayed welcome content requires a reviewed revision",
      });
    }
  });

export const onboardingJourneyTelemetrySchemas = [
  z
    .object({
      name: z.literal("onboarding_comparison"),
      properties: onboardingComparisonPropertiesSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("onboarding_navigation"),
      properties: onboardingNavigationPropertiesSchema,
    })
    .strict(),
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
  z
    .object({
      name: z.literal("onboarding_work_surface"),
      properties: onboardingWorkSurfacePropertiesSchema,
    })
    .strict(),
] as const;

export type OnboardingTelemetrySource = z.infer<
  typeof onboardingTelemetrySourceSchema
>;
export type OnboardingBlockerReason = z.infer<
  typeof onboardingBlockerReasonSchema
>;
