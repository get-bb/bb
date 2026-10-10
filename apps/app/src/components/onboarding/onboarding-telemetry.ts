import type { RecordTelemetryEventRequest } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

export type OnboardingEntry = "first_run" | "replay";

export function recordTelemetryEvent(event: RecordTelemetryEventRequest): void {
  void sdk.system
    .experimental_recordTelemetryEvent(event)
    .catch(() => undefined);
}
