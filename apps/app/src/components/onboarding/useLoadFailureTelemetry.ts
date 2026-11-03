import { useEffect } from "react";
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
}: {
  entry: OnboardingEntry;
  step: OnboardingStepId;
  noHost: boolean;
  query: { isError: boolean; error: unknown };
}): void {
  const failureReason: OperationFailureReason | "no_host" | null = noHost
    ? "no_host"
    : query.isError
      ? operationFailureReason(query.error)
      : null;
  useEffect(() => {
    if (failureReason === null) return;
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
