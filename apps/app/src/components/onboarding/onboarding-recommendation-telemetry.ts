import { publicMeasurementPluginSchema } from "@bb/server-contract";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

interface RecommendationContext {
  source: OnboardingEntry;
  marketplace: string;
  entryId: string;
  initial_state: "absent" | "disabled" | "enabled" | "unknown";
  availability: "available" | "unavailable" | "unknown";
}

export function createPluginRecommendationObserver() {
  let shown = false;
  let initialState: RecommendationContext["initial_state"] | null = null;
  return (
    action: "shown" | "selected" | "deselected",
    context: RecommendationContext,
  ) => {
    if (context.marketplace !== "bb-official") return;
    const public_plugin = publicMeasurementPluginSchema.safeParse(
      context.entryId,
    ).data;
    if (public_plugin === undefined || (action === "shown" && shown)) return;
    if (action === "shown") shown = true;
    initialState ??= context.initial_state;
    recordTelemetryEvent({
      name: "plugin_recommendation",
      properties: {
        action,
        public_plugin,
        source: context.source,
        initial_state: initialState,
        availability: context.availability,
      },
    });
  };
}
