import { z } from "zod";
import { clientDeviceStatePropertiesSchema } from "./system-device-telemetry.js";

export const onboardingTelemetrySourceSchema = z.enum([
  "first_run",
  "replay",
  "settings",
  "marketplace",
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

const agentStepStateSchema = z
  .object({
    surface: z.literal("onboarding"),
    entry: z.enum(["first_run", "replay"]),
    step: z.literal("agent"),
    resource_type: z.literal("agent"),
    resource_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/),
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

const projectStepStateSchema = z
  .object({
    surface: z.literal("onboarding"),
    entry: z.enum(["first_run", "replay"]),
    step: z.literal("projects"),
    resource_type: z.literal("project"),
    resource_id: z.literal("project_discovery"),
    action: z.enum(["scan_result", "folder_opened", "folder_result"]),
    state: z.enum([
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
    }[value.action].includes(value.state);
    if (!validResult) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Result must describe the observed project action",
      });
    }
  });

export const newThreadBlockerPropertiesSchema = z
  .object({
    state: z.enum(["shown", "cleared"]),
    reason: onboardingBlockerReasonSchema,
    surface: z.literal("homepage"),
    entry: z.enum(["first_run", "replay"]).nullable(),
  })
  .strict();

export const onboardingJourneyTelemetrySchemas = [
  z
    .object({
      name: z.literal("onboarding_step_state"),
      properties: z.union([
        agentStepStateSchema,
        projectStepStateSchema,
        clientDeviceStatePropertiesSchema,
      ]),
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
