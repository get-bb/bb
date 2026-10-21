import { LAPSED_RESUME_SUGGESTION } from "@bb/server-contract";
import { getAppSurface } from "@/lib/app-surface";
import { sdk } from "@/lib/sdk";

export function recordLapsedResumeShown(suggestionAnalyticsId: string): void {
  if (getAppSurface() === "mobile") return;
  void sdk.system
    .experimental_recordTelemetryEvent({
      name: "suggestion_shown",
      properties: {
        ...LAPSED_RESUME_SUGGESTION,
        suggestion_analytics_id: suggestionAnalyticsId,
      },
    })
    .catch(() => undefined);
}

export function recordLapsedResumeDismissed(
  suggestionAnalyticsId: string,
): void {
  if (getAppSurface() === "mobile") return;
  void sdk.system
    .experimental_recordTelemetryEvent({
      name: "suggestion_dismissed",
      properties: {
        surface: LAPSED_RESUME_SUGGESTION.surface,
        kind: LAPSED_RESUME_SUGGESTION.kind,
        suggestion_analytics_id: suggestionAnalyticsId,
        dismiss: "not_now",
      },
    })
    .catch(() => undefined);
}
