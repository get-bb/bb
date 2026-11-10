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

export function useLoadTelemetry({
  entry,
  step,
  hostWaitFailure,
  query,
  loaded,
  timedOut,
}: {
  entry: OnboardingEntry;
  step: OnboardingStepId;
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
