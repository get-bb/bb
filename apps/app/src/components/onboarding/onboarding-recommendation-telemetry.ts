import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

interface RecommendationContext {
  source: OnboardingEntry;
  marketplace: string;
  entryId: string;
}

export function createPluginRecommendationObserver() {
  const id = crypto.randomUUID();
  let shown = false;
  return Object.assign(
    (action: "shown", context: RecommendationContext) => {
      if (
        shown ||
        !["bb-official", "bb-community"].includes(context.marketplace)
      )
        return;
      shown = true;
      recordTelemetryEvent({
        name: "recommendation",
        properties: {
          action,
          resource_type: "plugin",
          resource_id: context.entryId,
          recommendation_id: id,
          surface: "onboarding",
          entry: context.source,
        },
      });
    },
    { id },
  );
}
