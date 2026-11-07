import { useCallback, useEffect, useRef } from "react";
import type { PluginInstallJob } from "@bb/server-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useSetPluginEnabled } from "@/components/plugin/useSetPluginEnabled";
import { applyPluginInstallJob } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  isActivePluginInstallJob,
  startCatalogPluginInstall,
  usePluginInstallJobs,
} from "@/hooks/queries/plugin-install-job-queries";
import { pluginInstallJobsQueryKey } from "@/hooks/queries/query-keys";
import {
  operationFailureReason,
  type OperationFailureReason,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

type PluginOperation = "install" | "enable" | "disable";

type PluginOutcome = "started" | "succeeded" | "failed";

function recordPluginOperation(
  onboardingEntry: OnboardingEntry,
  pluginId: string,
  operation: PluginOperation,
  outcome: PluginOutcome,
  failureReason?: OperationFailureReason | "command_failed",
): void {
  recordTelemetryEvent({
    name: "onboarding_operation",
    properties: {
      entry: onboardingEntry,
      step: "plugins",
      operation,
      outcome,
      resource_id: pluginId,
      ...(failureReason === undefined ? {} : { failure_reason: failureReason }),
    },
  });
}

export type TrackPluginInstall = (jobId: string, pluginId: string) => void;

export function useOnboardingPluginInstallOutcomes(
  onboardingEntry: OnboardingEntry,
): TrackPluginInstall {
  const queryClient = useQueryClient();
  const jobs = usePluginInstallJobs().data;
  const trackedRef = useRef(new Map<string, string>());
  const settle = useCallback(
    (current: readonly PluginInstallJob[] | undefined) => {
      for (const job of current ?? []) {
        const pluginId = trackedRef.current.get(job.id);
        if (pluginId === undefined || isActivePluginInstallJob(job)) continue;
        trackedRef.current.delete(job.id);
        if (job.state === "succeeded") {
          recordPluginOperation(
            onboardingEntry,
            pluginId,
            "install",
            "succeeded",
          );
        } else if (job.state === "failed") {
          recordPluginOperation(
            onboardingEntry,
            pluginId,
            "install",
            "failed",
            "command_failed",
          );
        }
      }
    },
    [onboardingEntry],
  );
  useEffect(() => settle(jobs), [jobs, settle]);
  return useCallback(
    (jobId: string, pluginId: string) => {
      trackedRef.current.set(jobId, pluginId);
      settle(
        queryClient.getQueryData<PluginInstallJob[]>(
          pluginInstallJobsQueryKey(),
        ),
      );
    },
    [queryClient, settle],
  );
}

export function useOnboardingPluginChange({
  onboardingEntry,
  plugin,
  trackInstall,
}: {
  onboardingEntry: OnboardingEntry;
  plugin: {
    pluginId: string;
    entryId: string;
    marketplace: string;
    installed: boolean;
  };
  trackInstall: TrackPluginInstall;
}): (enabled: boolean) => Promise<string | null> {
  const queryClient = useQueryClient();
  const setPluginEnabled = useSetPluginEnabled();
  const { pluginId, entryId, marketplace, installed } = plugin;

  return useCallback(
    async (enabled: boolean) => {
      const operation: PluginOperation =
        enabled && !installed ? "install" : enabled ? "enable" : "disable";
      const record = (
        outcome: PluginOutcome,
        failureReason?: OperationFailureReason,
      ) =>
        recordPluginOperation(
          onboardingEntry,
          pluginId,
          operation,
          outcome,
          failureReason,
        );
      record("started");
      try {
        if (operation === "install") {
          const job = await startCatalogPluginInstall(fetch, {
            entryId,
            marketplace,
          });
          applyPluginInstallJob({ queryClient, job });
          trackInstall(job.id, pluginId);
          return job.id;
        }
        await setPluginEnabled(pluginId, enabled);
        record("succeeded");
        return null;
      } catch (error) {
        record("failed", operationFailureReason(error));
        throw error;
      }
    },
    [
      entryId,
      installed,
      marketplace,
      onboardingEntry,
      pluginId,
      queryClient,
      setPluginEnabled,
      trackInstall,
    ],
  );
}
