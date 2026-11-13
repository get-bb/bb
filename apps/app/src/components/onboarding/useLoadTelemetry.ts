import { useEffect, useState } from "react";
import {
  operationFailureReason,
  type OnboardingStepId,
  type OperationFailureReason,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

interface StepLoadRecord {
  openedAt: number;
  succeeded: boolean;
  failed: boolean;
}

export type StepLoadRecords = Map<OnboardingStepId, StepLoadRecord>;

export function useLoadTelemetry({
  entry,
  step,
  records,
  noHost,
  query,
  loaded,
  timedOut,
}: {
  entry: OnboardingEntry;
  step: OnboardingStepId;
  records: StepLoadRecords;
  noHost: boolean;
  query: { isError: boolean; error: unknown };
  loaded: boolean;
  timedOut: boolean;
}): void {
  const [record] = useState(() => {
    const existing = records.get(step);
    if (existing !== undefined) return existing;
    const created = { openedAt: Date.now(), succeeded: false, failed: false };
    records.set(step, created);
    return created;
  });
  const failureReason: OperationFailureReason | "no_host" | null = noHost
    ? "no_host"
    : query.isError
      ? operationFailureReason(query.error)
      : timedOut
        ? "timed_out"
        : null;
  useEffect(() => {
    if (loaded || failureReason === null || record.failed) return;
    record.failed = true;
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
  }, [entry, failureReason, loaded, record, step]);
  useEffect(() => {
    if (!loaded || record.succeeded) return;
    record.succeeded = true;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step,
        operation: "load",
        outcome: "succeeded",
        duration_ms: Math.max(0, Math.round(Date.now() - record.openedAt)),
      },
    });
  }, [entry, loaded, record, step]);
}
