import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginRecommendationObserver } from "./onboarding-recommendation-telemetry";
const record = vi.hoisted(() => vi.fn());
vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: record }));
beforeEach(() => record.mockClear());
const context = {
  source: "first_run",
  marketplace: "bb-official",
  entryId: "prompt-library",
  initial_state: "enabled",
  availability: "available",
} as const;

describe("onboarding recommendations", () => {
  it("deduplicates exposure, retains initial enabled state, and reports only explicit choices", () => {
    const observe = createPluginRecommendationObserver();
    observe("shown", context);
    observe("shown", context);
    expect(record).toHaveBeenCalledTimes(1);
    observe("deselected", context);
    observe("selected", { ...context, initial_state: "disabled" });
    expect(record.mock.calls.map(([event]) => event.properties.action)).toEqual(
      ["shown", "deselected", "selected"],
    );
    expect(
      record.mock.calls.map(([event]) => event.properties.initial_state),
    ).toEqual(["enabled", "enabled", "enabled"]);
    createPluginRecommendationObserver()("shown", context);
    expect(record).toHaveBeenCalledTimes(4);
  });

  it("never exports private identities or treats unknown enabled state as disabled", () => {
    const observe = createPluginRecommendationObserver();
    observe("shown", { ...context, marketplace: "private" });
    observe("selected", { ...context, entryId: "private-name" });
    expect(record).not.toHaveBeenCalled();
    observe("shown", {
      ...context,
      initial_state: "unknown",
      availability: "unavailable",
    });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      name: "plugin_recommendation",
      properties: {
        action: "shown",
        public_plugin: "prompt-library",
        source: "first_run",
        initial_state: "unknown",
        availability: "unavailable",
      },
    });
  });
});
