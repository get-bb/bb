import type { PublicMeasurementPlugin } from "@bb/server-contract";
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

function publicRecommendation(
  context: RecommendationContext,
): PublicMeasurementPlugin | null {
  if (context.marketplace !== "bb-official") return null;
  switch (context.entryId) {
    case "browser-automation":
    case "workflows":
    case "monaco-editor":
    case "prompt-library":
    case "agent-annotations":
    case "ask-user-question":
      return context.entryId;
    default:
      return null;
  }
}

export function createPluginRecommendationObserver() {
  let shown = false;
  let initialState: RecommendationContext["initial_state"] | null = null;
  return (
    action: "shown" | "selected" | "deselected",
    context: RecommendationContext,
  ) => {
    const public_plugin = publicRecommendation(context);
    if (public_plugin === null || (action === "shown" && shown)) return;
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
