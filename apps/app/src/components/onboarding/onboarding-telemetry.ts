import type { RecordTelemetryEventRequest } from "@bb/server-contract";
import type { SystemRecordTelemetryEventOptions } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";

export type OnboardingEntry = "first_run" | "replay";

export function recordTelemetryEvent(
  event: RecordTelemetryEventRequest,
  options?: SystemRecordTelemetryEventOptions,
): void {
  void sdk.system
    .experimental_recordTelemetryEvent(event, options)
    .catch(() => undefined);
}
