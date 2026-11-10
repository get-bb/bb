import type { HostDiscoveredReposResponse } from "@bb/server-contract";
import { isCancelledError } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { operationFailureReason } from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";
import type { HostWaitFailure } from "./useReadyHost";

interface ProjectsScanState {
  data: HostDiscoveredReposResponse | undefined;
  dataUpdatedAt: number;
  error: unknown;
  errorUpdatedAt: number;
}

export function useProjectsScanTelemetry({
  entry,
  scan,
  hostWaitFailure,
}: {
  entry: OnboardingEntry;
  scan: ProjectsScanState;
  hostWaitFailure: HostWaitFailure | null;
}): void {
  const { data, dataUpdatedAt, error, errorUpdatedAt } = scan;
  useEffect(() => {
    if (dataUpdatedAt === 0 || data === undefined) return;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step: "projects",
        operation: "scan",
        outcome: "succeeded",
        item_count: data.repos.length,
        timed_out: data.truncated,
        unreadable_count: data.unreadableCount,
      },
    });
  }, [data, dataUpdatedAt, entry]);
  const reportedErrorAtRef = useRef(0);
  useEffect(() => {
    if (errorUpdatedAt === reportedErrorAtRef.current) return;
    if (error === null || isCancelledError(error)) return;
    reportedErrorAtRef.current = errorUpdatedAt;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step: "projects",
        operation: "scan",
        outcome: "failed",
        failure_reason: operationFailureReason(error),
      },
    });
  }, [entry, error, errorUpdatedAt]);
  const hostWaitReportedRef = useRef(false);
  useEffect(() => {
    if (hostWaitFailure === null || hostWaitReportedRef.current) return;
    hostWaitReportedRef.current = true;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step: "projects",
        operation: "scan",
        outcome: "failed",
        failure_reason: hostWaitFailure,
      },
    });
  }, [entry, hostWaitFailure]);
}
