import { describe, expect, it } from "vitest";
import { recordTelemetryEventRequestSchema } from "../src/api/system.js";
import {
  onboardingSuggestionGenerationPropertiesSchema,
  unknownWorkSuggestionAttribution,
  noWorkSuggestionAttribution,
  workSuggestionAttributionSchema,
} from "../src/api/system-suggestion-telemetry.js";

describe("suggestion measurement boundaries", () => {
  it("keeps missing attribution distinct from a known ordinary draft and rejects private metadata", () => {
    expect(
      workSuggestionAttributionSchema.parse(unknownWorkSuggestionAttribution())
        .origin,
    ).toBe("unknown");
    expect(
      workSuggestionAttributionSchema.parse(noWorkSuggestionAttribution())
        .origin,
    ).toBe("none");
    for (const value of [
      { ...noWorkSuggestionAttribution(), surface: "first_task" },
      { ...noWorkSuggestionAttribution(), reference: "local-only-reference" },
      { ...noWorkSuggestionAttribution(), template_key: "private-prompt-name" },
      {
        origin: "mixed",
        surface: "continuation",
        template_key: null,
        content_revision: "baseline",
        edit_state: "unchanged",
      },
      {
        origin: "curated",
        surface: "first_task",
        template_key: null,
        content_revision: "baseline",
        edit_state: "unchanged",
      },
    ])
      expect(workSuggestionAttributionSchema.safeParse(value).success).toBe(
        false,
      );
  });

  it("does not accept a client click as accepted work or an unreviewed suggestion revision", () => {
    const properties = {
      surface: "continuation",
      origin: "agent_context",
      action: "displayed",
      target: null,
      fallback_reason: "none",
      template_key: null,
      content_revision: "baseline",
      edit_state: "not_applicable",
    };
    const parse = (change: Record<string, unknown>) =>
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_suggestion",
        properties: { ...properties, ...change },
      }).success;
    expect(parse({})).toBe(true);
    for (const change of [
      { action: "send_accepted", target: "current_thread" },
      { target: "new_thread" },
      { action: "selected" },
      { content_revision: "arbitrary-release" },
      { origin: "mixed" },
      { prompt: "private suggestion" },
      { fallback_reason: "generation_failed" },
    ])
      expect(parse(change)).toBe(false);
    expect(parse({ action: "draft_inserted", target: "current_thread" })).toBe(
      true,
    );
  });

  it("distinguishes requested, empty, failed, cancelled and unknown generation without invented errors", () => {
    const base = {
      surface: "first_task",
      origin: "project_context",
      phase: "completed",
      latency: "1_to_3s",
    };
    for (const outcome of ["succeeded", "empty", "cancelled"]) {
      expect(
        onboardingSuggestionGenerationPropertiesSchema.safeParse({
          ...base,
          outcome,
          error_category: null,
        }).success,
      ).toBe(true);
      expect(
        onboardingSuggestionGenerationPropertiesSchema.safeParse({
          ...base,
          outcome,
          error_category: "transport",
        }).success,
      ).toBe(false);
    }
    for (const outcome of ["failed", "unknown"]) {
      expect(
        onboardingSuggestionGenerationPropertiesSchema.safeParse({
          ...base,
          outcome,
          error_category: "transport",
        }).success,
      ).toBe(true);
      expect(
        onboardingSuggestionGenerationPropertiesSchema.safeParse({
          ...base,
          outcome,
          error_category: null,
        }).success,
      ).toBe(false);
    }
    expect(
      onboardingSuggestionGenerationPropertiesSchema.safeParse({
        ...base,
        phase: "requested",
        outcome: "started",
        latency: "unknown",
        error_category: null,
      }).success,
    ).toBe(true);
    expect(
      onboardingSuggestionGenerationPropertiesSchema.safeParse({
        ...base,
        phase: "requested",
        outcome: "succeeded",
        error_category: null,
      }).success,
    ).toBe(false);
  });
});
