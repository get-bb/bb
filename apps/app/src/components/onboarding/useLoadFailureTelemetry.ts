import { useEffect, useRef } from "react";
import {
  operationFailureReason,
  type OnboardingStepId,
  type OperationFailureReason,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

export function useLoadFailureTelemetry({
  entry,
  step,
  noHost,
  query,
  timedOut,
}: {
  entry: OnboardingEntry;
  step: OnboardingStepId;
  noHost: boolean;
  query: { isError: boolean; error: unknown };
  timedOut: boolean;
}): void {
  const failureReason: OperationFailureReason | "no_host" | null = noHost
    ? "no_host"
    : query.isError
      ? operationFailureReason(query.error)
      : timedOut
        ? "timed_out"
        : null;
  const failingRef = useRef(false);
  useEffect(() => {
    if (failureReason === null) {
      failingRef.current = false;
      return;
    }
    if (failingRef.current) return;
    failingRef.current = true;
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
  }, [entry, failureReason, step]);
}
