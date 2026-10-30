import type { RecordTelemetryEventRequest } from "@bb/server-contract";
import { useEffect, useRef } from "react";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import {
  takeOnboardingWorkSource,
  type WorkSource,
} from "./onboarding-work-context";

export type NewThreadBlockerReason = Extract<
  RecordTelemetryEventRequest,
  { name: "new_thread_blocker" }
>["properties"]["reason"];

export type NewThreadReadiness =
  | { status: "ready" }
  | { status: "pending" | "empty"; message: string }
  | { status: "blocked"; reason: NewThreadBlockerReason; message: string };

export function useNewThreadBlockerObservation(
  hasDraft: boolean,
  readiness: NewThreadReadiness,
): void {
  const source = useRef<WorkSource | null>(null);
  const blockers = useRef(new Set<NewThreadBlockerReason>());
  useEffect(() => {
    if (!hasDraft) return;
    source.current ??= takeOnboardingWorkSource();
    if (readiness.status === "blocked") {
      if (blockers.current.has(readiness.reason)) return;
      blockers.current.add(readiness.reason);
      recordTelemetryEvent({
        name: "new_thread_blocker",
        properties: {
          state: "shown",
          reason: readiness.reason,
          source: source.current,
        },
      });
    } else if (readiness.status === "ready") {
      for (const reason of blockers.current) {
        recordTelemetryEvent({
          name: "new_thread_blocker",
          properties: { state: "cleared", reason, source: source.current },
        });
      }
      blockers.current.clear();
    }
  }, [hasDraft, readiness]);
}
