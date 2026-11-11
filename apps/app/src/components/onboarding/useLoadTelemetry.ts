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

export type StepLoadTimes = Map<
  OnboardingStepId,
  { shownAt: number; reported: boolean }
>;

export function useStepLoadTimes(): StepLoadTimes {
  const [loadTimes] = useState<StepLoadTimes>(() => new Map());
  return loadTimes;
}

export function useLoadTelemetry({
  entry,
  step,
  loadTimes,
  hostWaitFailure,
  query,
  loaded,
  timedOut,
}: {
  entry: OnboardingEntry;
  step: OnboardingStepId;
  loadTimes: StepLoadTimes;
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
  useEffect(() => {
    if (!loadTimes.has(step)) {
      loadTimes.set(step, { shownAt: Date.now(), reported: false });
    }
  }, [loadTimes, step]);
  useEffect(() => {
    const timing = loadTimes.get(step);
    if (!loaded || timing === undefined || timing.reported) return;
    loadTimes.set(step, { ...timing, reported: true });
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step,
        operation: "load",
        outcome: "succeeded",
        duration_ms: Math.max(0, Math.round(Date.now() - timing.shownAt)),
      },
    });
  }, [entry, loadTimes, loaded, step]);
}
