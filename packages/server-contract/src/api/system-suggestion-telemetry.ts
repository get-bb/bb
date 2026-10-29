import { z } from "zod";

export const suggestionSurfaceSchema = z.enum(["first_task", "continuation"]);
export const suggestionOriginSchema = z.enum([
  "curated",
  "project_context",
  "agent_context",
]);
export const suggestionTemplateKeySchema = z.never().nullable();
export const suggestionContentRevisionSchema = z.literal("baseline");

export const workSuggestionAttributionSchema = z
  .object({
    origin: z.enum([
      "curated",
      "project_context",
      "agent_context",
      "mixed",
      "none",
      "unknown",
    ]),
    surface: suggestionSurfaceSchema.nullable(),
    template_key: suggestionTemplateKeySchema,
    content_revision: suggestionContentRevisionSchema.nullable(),
    edit_state: z.enum(["unchanged", "edited", "unknown", "not_applicable"]),
  })
  .strict()
  .superRefine((value, context) => {
    const absent = value.origin === "none" || value.origin === "unknown";
    if (
      absent
        ? value.surface !== null ||
          value.template_key !== null ||
          value.content_revision !== null ||
          value.edit_state !==
            (value.origin === "none" ? "not_applicable" : "unknown")
        : value.surface === null ||
          value.content_revision === null ||
          value.edit_state === "not_applicable"
    ) {
      context.addIssue({
        code: "custom",
        message: "Attribution fields must describe the observed source",
      });
    }
    if (value.origin === "curated" && value.template_key === null) {
      context.addIssue({
        code: "custom",
        path: ["template_key"],
        message: "Curated suggestions require a reviewed template key",
      });
    }
    if (value.origin === "mixed" && value.edit_state !== "unknown") {
      context.addIssue({
        code: "custom",
        path: ["edit_state"],
        message: "Combined suggestions have unknown individual attribution",
      });
    }
  });

export type WorkSuggestionAttribution = z.infer<
  typeof workSuggestionAttributionSchema
>;

export function unknownWorkSuggestionAttribution(): WorkSuggestionAttribution {
  return {
    origin: "unknown",
    surface: null,
    template_key: null,
    content_revision: null,
    edit_state: "unknown",
  };
}

export function noWorkSuggestionAttribution(): WorkSuggestionAttribution {
  return {
    origin: "none",
    surface: null,
    template_key: null,
    content_revision: null,
    edit_state: "not_applicable",
  };
}

const suggestionObservationFields = {
  surface: suggestionSurfaceSchema,
  origin: suggestionOriginSchema,
  target: z.enum(["current_thread", "new_thread"]).nullable(),
  fallback_reason: z.enum([
    "none",
    "context_unavailable",
    "cloud_disabled",
    "generation_failed",
    "generation_empty",
    "unknown",
  ]),
  template_key: suggestionTemplateKeySchema,
  content_revision: suggestionContentRevisionSchema,
  edit_state: z.literal("not_applicable"),
};

export const onboardingSuggestionPropertiesSchema = z
  .object({
    ...suggestionObservationFields,
    action: z.enum([
      "displayed",
      "selected",
      "draft_inserted",
      "draft_replaced",
      "dismissed",
      "new_thread_opened",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.action === "displayed" && value.target !== null) ||
      (value.action !== "displayed" &&
        value.action !== "dismissed" &&
        value.target === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "A destination requires an actual choice",
      });
    }
    if (value.origin === "curated" && value.template_key === null) {
      context.addIssue({
        code: "custom",
        path: ["template_key"],
        message: "Curated suggestions require a reviewed template key",
      });
    }
    if (value.origin !== "curated" && value.fallback_reason !== "none") {
      context.addIssue({
        code: "custom",
        path: ["fallback_reason"],
        message: "Fallback describes rendered curated content",
      });
    }
  });

export const onboardingSuggestionGenerationPropertiesSchema = z
  .object({
    surface: suggestionSurfaceSchema,
    origin: z.enum(["project_context", "agent_context"]),
    phase: z.enum(["requested", "completed"]),
    outcome: z.enum([
      "started",
      "succeeded",
      "empty",
      "failed",
      "cancelled",
      "unknown",
    ]),
    latency: z.enum(["under_1s", "1_to_3s", "3_to_10s", "over_10s", "unknown"]),
    error_category: z
      .enum([
        "unavailable",
        "authentication",
        "rate_limit",
        "transport",
        "invalid_result",
        "unknown",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const error = value.outcome === "failed" || value.outcome === "unknown";
    if (
      value.phase === "requested"
        ? value.outcome !== "started" ||
          value.latency !== "unknown" ||
          value.error_category !== null
        : value.outcome === "started" ||
          error !== (value.error_category !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Generation phase, outcome and error category must agree",
      });
    }
  });

export const onboardingSuggestionTelemetrySchemas = [
  z
    .object({
      name: z.literal("onboarding_suggestion"),
      properties: onboardingSuggestionPropertiesSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("onboarding_suggestion_generation"),
      properties: onboardingSuggestionGenerationPropertiesSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("onboarding_context_choice"),
      properties: z
        .object({
          action: z.enum(["offered", "enabled", "disabled"]),
          scope: z.enum(["none", "project_summary"]),
        })
        .strict(),
    })
    .strict(),
] as const;
