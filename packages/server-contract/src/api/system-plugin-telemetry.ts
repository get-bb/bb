import { z } from "zod";

export const pluginMeasurementSourceSchema = z.enum([
  "first_run",
  "replay",
  "settings",
  "cli",
  "during_first_thread",
  "after_first_thread",
  "other",
  "unknown",
]);
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

const pluginSourceSchema = z.enum([
  "builtin",
  "public_catalog",
  "private",
  "local",
  "unknown",
]);
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
      action: z.literal("workflow_started"),
      outcome: z.literal("succeeded"),
    })
    .strict(),
  z
    .object({
      action: z.literal("editor_opened"),
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
      action: z.literal("prompt_inserted"),
      outcome: z.literal("observed"),
    })
    .strict(),
  z
    .object({
      action: z.literal("annotation_inserted"),
      outcome: z.literal("observed"),
    })
    .strict(),
  z
    .object({
      action: z.literal("question_created"),
      outcome: z.literal("succeeded"),
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

const pluginUseActionSchema = z.enum([
  "browser_run",
  "workflow_started",
  "editor_opened",
  "file_saved",
  "prompt_inserted",
  "annotation_inserted",
  "question_created",
  "question_answered",
]);
const pluginUseOutcomeSchema = z.enum([
  "invoked",
  "observed",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

export const internalPluginUseReportSchema = z
  .object({
    action: pluginUseActionSchema,
    outcome: pluginUseOutcomeSchema,
    initiator: pluginUseInitiatorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !pluginUseObservationSchema.safeParse({
        action: value.action,
        outcome: value.outcome,
      }).success
    )
      context.addIssue({
        code: "custom",
        message: "Outcome is not supported for this action",
      });
  });

export const pluginUseTelemetryEventSchema = z
  .object({
    name: z.literal("plugin_use"),
    properties: z
      .object({
        public_plugin: publicMeasurementPluginSchema.nullable(),
        plugin_source: pluginSourceSchema,
        initiator: pluginUseInitiatorSchema,
        action: z.union([z.literal("other_action"), pluginUseActionSchema]),
        outcome: z.enum([
          "invoked",
          "observed",
          "succeeded",
          "failed",
          "cancelled",
          "unknown",
        ]),
      })
      .strict()
      .superRefine((value, context) => {
        const valid =
          value.action === "other_action"
            ? value.public_plugin === null && value.outcome === "invoked"
            : value.public_plugin === actionOwners[value.action] &&
              (value.plugin_source === "builtin" ||
                value.plugin_source === "public_catalog") &&
              pluginUseObservationSchema.safeParse({
                action: value.action,
                outcome: value.outcome,
              }).success;
        if (!valid)
          context.addIssue({
            code: "custom",
            message: "Plugin action must match its owner and observed outcome",
          });
      }),
  })
  .strict();

export const pluginStateChangedTelemetryEventSchema = z
  .object({
    name: z.literal("plugin_state_changed"),
    properties: z
      .object({
        public_plugin: publicMeasurementPluginSchema.nullable(),
        plugin_source: pluginSourceSchema,
        source: pluginMeasurementSourceSchema,
        previous_state: z.enum(["absent", "disabled", "enabled", "unknown"]),
        state: z.enum(["enabled", "disabled"]),
      })
      .strict()
      .superRefine((value, context) => {
        if (
          value.state === value.previous_state ||
          (value.public_plugin !== null &&
            value.plugin_source !== "builtin" &&
            value.plugin_source !== "public_catalog")
        ) {
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
        action: z.enum([
          "shown",
          "browse_opened",
          "selected",
          "deselected",
          "dismissed",
        ]),
        public_plugin: publicMeasurementPluginSchema.nullable(),
        recommendation_revision: z.literal("baseline"),
        source: pluginMeasurementSourceSchema,
        initial_state: z.enum(["absent", "disabled", "enabled", "unknown"]),
        availability: z.enum(["available", "unavailable", "unknown"]),
      })
      .strict()
      .superRefine((value, context) => {
        const wholeSurface =
          value.action === "browse_opened" ||
          (value.action === "dismissed" && value.public_plugin === null);
        if (
          (wholeSurface &&
            (value.public_plugin !== null ||
              value.initial_state !== "unknown" ||
              value.availability !== "unknown")) ||
          (!wholeSurface && value.public_plugin === null) ||
          (value.action === "dismissed" &&
            value.source !== "during_first_thread" &&
            value.source !== "after_first_thread")
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recommendation observation must identify the actual card or whole surface",
          });
        }
      }),
  })
  .strict();
