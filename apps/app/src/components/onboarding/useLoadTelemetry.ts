import { useEffect, useRef, useState } from "react";
import {
  operationFailureReason,
  type OnboardingStepId,
  type OperationFailureReason,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";
import type { HostWaitFailure } from "./useReadyHost";

export type ReportedLoadFailures = Set<OnboardingStepId>;

export function useLoadTelemetry({
  entry,
  step,
  reportedFailures,
  hostWaitFailure,
  query,
  loaded,
  timedOut,
}: {
  entry: OnboardingEntry;
  step: OnboardingStepId;
  reportedFailures: ReportedLoadFailures;
  hostWaitFailure: HostWaitFailure | null;
  query: { isError: boolean; error: unknown };
  loaded: boolean;
  timedOut: boolean;
}): void {
  const failureReason: OperationFailureReason | HostWaitFailure | null =
    hostWaitFailure ??
    (query.isError
      ? operationFailureReason(query.error)
      : timedOut
        ? "timed_out"
        : null);
  useEffect(() => {
    if (failureReason === null || reportedFailures.has(step)) return;
    reportedFailures.add(step);
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step,
        operation: "load",
        outcome: "failed",
        failure_reason: failureReason,
      },
    });
  }, [entry, failureReason, reportedFailures, step]);
  const [shownAt] = useState(() => Date.now());
  const succeededRef = useRef(false);
  useEffect(() => {
    if (!loaded || succeededRef.current) return;
    succeededRef.current = true;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step,
        operation: "load",
        outcome: "succeeded",
        duration_ms: Math.max(0, Math.round(Date.now() - shownAt)),
      },
    });
  }, [entry, loaded, shownAt, step]);
}
