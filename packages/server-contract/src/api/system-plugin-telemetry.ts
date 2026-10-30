import { z } from "zod";
import { onboardingTelemetrySourceSchema } from "./system-journey-telemetry.js";

export const pluginMeasurementSourceSchema = onboardingTelemetrySourceSchema;
export type PluginMeasurementSource = z.infer<
  typeof pluginMeasurementSourceSchema
>;

export const publicMeasurementPluginSchema = z.enum([
  "browser-automation",
  "workflows",
  "monaco-editor",
  "prompt-library",
  "agent-annotations",
  "ask-user-question",
]);
export type PublicMeasurementPlugin = z.infer<
  typeof publicMeasurementPluginSchema
>;

const pluginSourceSchema = z.enum(["builtin", "public_catalog"]);
export const pluginUseInitiatorSchema = z.enum([
  "user",
  "agent",
  "automation",
  "plugin",
  "system",
  "unknown",
]);
export type PluginUseInitiator = z.infer<typeof pluginUseInitiatorSchema>;

export const pluginUseObservationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("browser_run"),
      outcome: z.enum(["invoked", "succeeded", "failed", "unknown"]),
    })
    .strict(),
  z
    .object({
      action: z.enum(["workflow_started", "question_created"]),
      outcome: z.literal("succeeded"),
    })
    .strict(),
  z
    .object({
      action: z.enum(["editor_opened", "prompt_inserted", "annotation_inserted"]),
      outcome: z.literal("observed"),
    })
    .strict(),
  z
    .object({
      action: z.literal("file_saved"),
      outcome: z.enum(["succeeded", "failed"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("question_answered"),
      outcome: z.enum(["succeeded", "cancelled", "unknown", "failed"]),
    })
    .strict(),
]);
export type PluginUseObservation = z.infer<typeof pluginUseObservationSchema>;

const actionOwners = {
  browser_run: "browser-automation",
  workflow_started: "workflows",
  editor_opened: "monaco-editor",
  file_saved: "monaco-editor",
  prompt_inserted: "prompt-library",
  annotation_inserted: "agent-annotations",
  question_created: "ask-user-question",
  question_answered: "ask-user-question",
} as const satisfies Record<
  PluginUseObservation["action"],
  PublicMeasurementPlugin
>;

const [firstObservation, ...otherObservations] = pluginUseObservationSchema.options;
const reportFields = { initiator: pluginUseInitiatorSchema.optional() };
const useFields = {
  public_plugin: publicMeasurementPluginSchema,
  plugin_source: pluginSourceSchema,
  initiator: pluginUseInitiatorSchema,
};

export const internalPluginUseReportSchema = z.discriminatedUnion("action", [
  firstObservation.extend(reportFields),
  ...otherObservations.map((option) => option.extend(reportFields)),
]);

export const pluginUseTelemetryEventSchema = z
  .object({
    name: z.literal("plugin_use"),
    properties: z
      .discriminatedUnion("action", [
        firstObservation.extend(useFields),
        ...otherObservations.map((option) => option.extend(useFields)),
      ])
      .superRefine((value, context) => {
        if (value.public_plugin !== actionOwners[value.action])
          context.addIssue({
            code: "custom",
            message: "Plugin action must match its owner",
          });
      }),
  })
  .strict();

export const pluginStateChangedTelemetryEventSchema = z
  .object({
    name: z.literal("plugin_state_changed"),
    properties: z
      .object({
        public_plugin: publicMeasurementPluginSchema,
        plugin_source: pluginSourceSchema,
        source: pluginMeasurementSourceSchema,
        previous_state: z.enum(["absent", "disabled", "enabled", "unknown"]),
        state: z.enum(["enabled", "disabled"]),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.state === value.previous_state) {
          context.addIssue({
            code: "custom",
            message: "Expected a confirmed transition with public provenance",
          });
        }
      }),
  })
  .strict();
export type PluginMeasurementEvent =
  | z.infer<typeof pluginUseTelemetryEventSchema>
  | z.infer<typeof pluginStateChangedTelemetryEventSchema>;

export const pluginRecommendationTelemetryEventSchema = z
  .object({
    name: z.literal("plugin_recommendation"),
    properties: z
      .object({
        action: z.enum(["shown", "selected", "deselected"]),
        public_plugin: publicMeasurementPluginSchema,
        source: pluginMeasurementSourceSchema,
        initial_state: z.enum(["absent", "disabled", "enabled", "unknown"]),
        availability: z.enum(["available", "unavailable", "unknown"]),
      })
      .strict(),
  })
  .strict();
