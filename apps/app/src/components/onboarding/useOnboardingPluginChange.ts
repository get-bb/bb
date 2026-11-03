import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSetPluginEnabled } from "@/components/plugin/useSetPluginEnabled";
import { applyPluginInstallJob } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  startCatalogPluginInstall,
  usePluginInstallJob,
} from "@/hooks/queries/plugin-install-job-queries";
import {
  operationFailureReason,
  type OperationFailureReason,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

type PluginOperation = "install" | "enable" | "disable";

export function useOnboardingPluginChange({
  onboardingEntry,
  plugin,
}: {
  onboardingEntry: OnboardingEntry;
  plugin: {
    pluginId: string;
    entryId: string;
    marketplace: string;
    installed: boolean;
  };
}): (enabled: boolean) => Promise<void> {
  const queryClient = useQueryClient();
  const setPluginEnabled = useSetPluginEnabled();
  const { pluginId, entryId, marketplace, installed } = plugin;
  const record = useCallback(
    (
      operation: PluginOperation,
      outcome: "started" | "succeeded" | "failed",
      failureReason?: OperationFailureReason | "command_failed",
    ) =>
      recordTelemetryEvent({
        name: "onboarding_operation",
        properties: {
          entry: onboardingEntry,
          step: "plugins",
          operation,
          outcome,
          resource_id: pluginId,
          ...(failureReason === undefined
            ? {}
            : { failure_reason: failureReason }),
        },
      }),
    [onboardingEntry, pluginId],
  );

  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const trackedJobState = usePluginInstallJob(trackedJobId)?.state;
  const settledJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (trackedJobId === null || settledJobIdRef.current === trackedJobId) {
      return;
    }
    if (trackedJobState === "succeeded") {
      record("install", "succeeded");
    } else if (trackedJobState === "failed") {
      record("install", "failed", "command_failed");
    } else if (trackedJobState !== "cancelled") {
      return;
    }
    settledJobIdRef.current = trackedJobId;
  }, [record, trackedJobId, trackedJobState]);

  return useCallback(
    async (enabled: boolean) => {
      const operation: PluginOperation =
        enabled && !installed ? "install" : enabled ? "enable" : "disable";
      record(operation, "started");
      try {
        if (operation === "install") {
          const job = await startCatalogPluginInstall(fetch, {
            entryId,
            marketplace,
          });
          applyPluginInstallJob({ queryClient, job });
          setTrackedJobId(job.id);
        } else {
          await setPluginEnabled(pluginId, enabled);
          record(operation, "succeeded");
        }
      } catch (error) {
        record(operation, "failed", operationFailureReason(error));
        throw error;
      }
    },
    [
      entryId,
      installed,
      marketplace,
      pluginId,
      queryClient,
      record,
      setPluginEnabled,
    ],
  );
}
