import type { HostDiscoveredReposResponse } from "@bb/server-contract";
import { isCancelledError } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { operationFailureReason } from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

interface ProjectsScanState {
  data: HostDiscoveredReposResponse | undefined;
  dataUpdatedAt: number;
  error: unknown;
  errorUpdatedAt: number;
}

export function useProjectsScanTelemetry({
  entry,
  scan,
  noHost,
}: {
  entry: OnboardingEntry;
  scan: ProjectsScanState;
  noHost: boolean;
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
  const noHostReportedRef = useRef(false);
  useEffect(() => {
    if (!noHost || noHostReportedRef.current) return;
    noHostReportedRef.current = true;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step: "projects",
        operation: "scan",
        outcome: "failed",
        failure_reason: "no_host",
      },
    });
  }, [entry, noHost]);
}
