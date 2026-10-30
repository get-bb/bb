import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import type { PluginInstallJob } from "@bb/server-contract";
import { pluginInstallJobsQueryOptions } from "@/hooks/queries/plugin-install-job-queries";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

export async function runOnboardingPluginAction<T>(
  entry: OnboardingEntry,
  operation: "install" | "enable",
  resourceId: string,
  action: () => Promise<T>,
): Promise<T> {
  recordTelemetryEvent({
    name: "onboarding_operation",
    properties: {
      entry,
      surface: "onboarding",
      step: "plugins",
      resource_type: "plugin",
      resource_id: resourceId,
      operation,
      outcome: "started",
      error_category: null,
    },
  });
  let result: T;
  try {
    result = await action();
  } catch (error) {
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        surface: "onboarding",
        step: "plugins",
        resource_type: "plugin",
        resource_id: resourceId,
        operation,
        outcome: operation === "install" ? "unknown" : "failed",
        error_category: "request",
      },
    });
    throw error;
  }
  if (operation === "enable") {
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        surface: "onboarding",
        step: "plugins",
        resource_type: "plugin",
        resource_id: resourceId,
        operation,
        outcome: "succeeded",
        error_category: null,
      },
    });
  }
  return result;
}

export function observeOnboardingPluginInstall(
  queryClient: QueryClient,
  initialJob: PluginInstallJob,
  entry: OnboardingEntry,
  resourceId: string,
): void {
  let unknownRecorded = false;
  const recordUnknown = () => {
    if (unknownRecorded) return;
    unknownRecorded = true;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        surface: "onboarding",
        step: "plugins",
        resource_type: "plugin",
        resource_id: resourceId,
        operation: "install",
        outcome: "unknown",
        error_category: "request",
      },
    });
  };
  const recordTerminal = (job: PluginInstallJob): boolean => {
    if (
      job.state !== "succeeded" &&
      job.state !== "failed" &&
      job.state !== "cancelled"
    )
      return false;
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        surface: "onboarding",
        step: "plugins",
        resource_type: "plugin",
        resource_id: resourceId,
        operation: "install",
        outcome: job.state,
        error_category: job.state === "failed" ? "job_failed" : null,
      },
    });
    return true;
  };
  if (recordTerminal(initialJob)) return;
  const observer = new QueryObserver(
    queryClient,
    pluginInstallJobsQueryOptions,
  );
  let finished = false;
  let unsubscribe = () => {};
  const observe = () => {
    if (finished) return;
    const result = observer.getCurrentResult();
    const job = result.data?.find(
      (candidate) => candidate.id === initialJob.id,
    );
    if (job !== undefined && recordTerminal(job)) {
      finished = true;
      unsubscribe();
    } else if (result.isError) {
      recordUnknown();
    }
  };
  unsubscribe = observer.subscribe(observe);
  observe();
  if (finished) unsubscribe();
}
