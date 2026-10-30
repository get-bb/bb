import { describe, expect, it } from "vitest";
import {
  internalPluginUseReportSchema,
  pluginUseTelemetryEventSchema,
  pluginStateChangedTelemetryEventSchema,
  pluginRecommendationTelemetryEventSchema,
  pluginInstallRequestSchema,
  pluginCatalogInstallRequestSchema,
  pluginStateMeasurementRequestSchema,
  recordTelemetryEventRequestSchema,
} from "../src/index.js";

const browserUse = {
  name: "plugin_use",
  properties: {
    public_plugin: "browser-automation",
    plugin_source: "builtin",
    initiator: "agent",
    action: "browser_run",
    outcome: "succeeded",
  },
};

describe("plugin telemetry boundary", () => {
  it.each([
    { action: "editor_opened", outcome: "succeeded" },
    { action: "other_action", outcome: "succeeded" },
    { action: "prompt_inserted", outcome: "failed" },
    { action: "workflow_started", outcome: "invoked" },
    { action: "question_created", outcome: "cancelled" },
  ])("rejects incompatible observed result %j", (report) => {
    expect(internalPluginUseReportSchema.safeParse(report).success).toBe(false);
  });
  it("rejects private identity and extra data, and does not accept server-confirmed events from the frontend endpoint", () => {
    expect(pluginUseTelemetryEventSchema.safeParse(browserUse).success).toBe(
      true,
    );
    for (const extra of [
      { plugin_id: "private" },
      { args: "private" },
      { output: "private" },
      { public_plugin: "private" },
      { public_plugin: null },
      { action: "other_action", outcome: "invoked" },
      { plugin_source: "local" },
    ]) {
      expect(
        pluginUseTelemetryEventSchema.safeParse({
          ...browserUse,
          properties: { ...browserUse.properties, ...extra },
        }).success,
      ).toBe(false);
    }
    expect(
      recordTelemetryEventRequestSchema.safeParse(browserUse).success,
    ).toBe(false);
    expect(
      internalPluginUseReportSchema.safeParse({
        action: "browser_run",
        outcome: "invoked",
        initiator: "user",
      }).success,
    ).toBe(true);
    expect(
      internalPluginUseReportSchema.safeParse({
        action: "browser_run",
        outcome: "invoked",
        pluginId: "browser-automation",
      }).success,
    ).toBe(false);
  });
  it("rejects unchanged state and invalid public provenance", () => {
    const event = {
      name: "plugin_state_changed",
      properties: {
        public_plugin: "workflows",
        plugin_source: "builtin",
        source: "first_run",
        previous_state: "disabled",
        state: "enabled",
      },
    };
    expect(
      pluginStateChangedTelemetryEventSchema.safeParse(event).success,
    ).toBe(true);
    expect(
      pluginStateChangedTelemetryEventSchema.safeParse({
        ...event,
        properties: { ...event.properties, state: "disabled" },
      }).success,
    ).toBe(false);
    expect(
      pluginStateChangedTelemetryEventSchema.safeParse({
        ...event,
        properties: { ...event.properties, plugin_source: "private" },
      }).success,
    ).toBe(false);
  });
  it("keeps only current recommendation actions and sources", () => {
    const event = {
      name: "plugin_recommendation",
      properties: {
        action: "deselected",
        public_plugin: "workflows",
        source: "first_run",
        initial_state: "enabled",
        availability: "available",
      },
    };
    expect(
      pluginRecommendationTelemetryEventSchema.safeParse(event).success,
    ).toBe(true);
    for (const extra of [
      { action: "browse_opened" },
      { action: "dismissed" },
      { source: "during_first_thread" },
      { source: "after_first_thread" },
      { public_plugin: null },
      { recommendation_revision: "baseline" },
    ]) {
      expect(
        pluginRecommendationTelemetryEventSchema.safeParse({
          ...event,
          properties: { ...event.properties, ...extra },
        }).success,
      ).toBe(false);
    }
  });

  it("preserves legacy requests with unknown source and rejects unbounded source", () => {
    expect(
      pluginInstallRequestSchema.parse({ source: "builtin:workflows" })
        .measurementSource,
    ).toBe("unknown");
    expect(
      pluginCatalogInstallRequestSchema.parse({ entryId: "workflows" })
        .measurementSource,
    ).toBe("unknown");
    expect(
      pluginStateMeasurementRequestSchema.parse({}).measurementSource,
    ).toBe("unknown");
    expect(
      pluginStateMeasurementRequestSchema.parse({ measurementSource: "replay" })
        .measurementSource,
    ).toBe("replay");
    expect(
      pluginStateMeasurementRequestSchema.safeParse({
        measurementSource: "private-path",
      }).success,
    ).toBe(false);
    expect(
      pluginStateMeasurementRequestSchema.safeParse({
        measurementSource: "settings",
        path: "/private",
      }).success,
    ).toBe(false);
  });
});
