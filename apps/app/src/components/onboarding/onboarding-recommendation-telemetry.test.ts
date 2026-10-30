import { beforeEach, expect, it, vi } from "vitest";
import { createPluginRecommendationObserver } from "./onboarding-recommendation-telemetry";
const record = vi.hoisted(() => vi.fn());
vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: record }));
beforeEach(() => record.mockClear());
it("deduplicates visible exposure and gives each recommendation a distinct identity", () => {
  const context = {
    source: "first_run",
    marketplace: "bb-official",
    entryId: "another-public-plugin",
  } as const;
  const first = createPluginRecommendationObserver();
  first("shown", context);
  first("shown", context);
  const second = createPluginRecommendationObserver();
  second("shown", context);
  expect(first.id).not.toBe(second.id);
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[0][0]).toEqual({
    name: "recommendation",
    properties: {
      resource_type: "plugin",
      resource_id: context.entryId,
      recommendation_id: first.id,
      surface: "onboarding",
      entry: "first_run",
      action: "shown",
    },
  });
});
it("does not export private catalog identities", () => {
  createPluginRecommendationObserver()("shown", {
    source: "replay",
    marketplace: "private",
    entryId: "secret",
  });
  expect(record).not.toHaveBeenCalled();
});
