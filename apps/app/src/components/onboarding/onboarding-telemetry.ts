import type { RecordTelemetryEventRequest } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

export type OnboardingEntry = "first_run" | "checklist";

export function recordTelemetryEvent(event: RecordTelemetryEventRequest): void {
  void sdk.system
    .experimental_recordTelemetryEvent(event)
    .catch(() => undefined);
}
