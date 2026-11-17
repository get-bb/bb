import { useCallback, useRef, useState } from "react";
import type { PluginInstallJob } from "@bb/server-contract";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isActivePluginInstallJob } from "@/hooks/queries/plugin-install-job-queries";
import {
  invalidatePluginList,
  refreshPluginCatalogSearch,
} from "@/hooks/cache-owners/plugin-cache-owner";
import { pluginInstallJobsQueryKey } from "@/hooks/queries/query-keys";

export type PluginSwitchApply = (enabled: boolean) => Promise<string | null>;

export interface PluginSwitchRequest {
  pluginId: string;
  enabled: boolean;
  serverEnabled: boolean;
  apply: PluginSwitchApply;
  onFailed: (error: unknown) => void;
}

export interface OnboardingPluginSwitches {
  shown: (pluginId: string, serverEnabled: boolean) => boolean;
  set: (request: PluginSwitchRequest) => void;
}

function finishedInstallJobState(
  queryClient: QueryClient,
  jobId: string,
): PluginInstallJob["state"] | null {
  const job = queryClient
    .getQueryData<PluginInstallJob[]>(pluginInstallJobsQueryKey())
    ?.find((candidate) => candidate.id === jobId);
  return job === undefined || isActivePluginInstallJob(job) ? null : job.state;
}

function waitForInstallJob(
  queryClient: QueryClient,
  jobId: string,
): Promise<PluginInstallJob["state"]> {
  return new Promise((resolve) => {
    const done = finishedInstallJobState(queryClient, jobId);
    if (done !== null) {
      resolve(done);
      return;
    }
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const state = finishedInstallJobState(queryClient, jobId);
      if (state === null) return;
      unsubscribe();
      resolve(state);
    });
  });
}

interface PluginSwitchState {
  desired: Map<string, boolean>;
  applied: Map<string, boolean>;
  requests: Map<string, PluginSwitchRequest>;
  running: Set<string>;
}

async function drivePluginSwitch(
  pluginId: string,
  switches: PluginSwitchState,
  queryClient: QueryClient,
  refresh: () => Promise<void>,
  settle: (pluginId: string) => void,
): Promise<void> {
  if (switches.running.has(pluginId)) return;
  switches.running.add(pluginId);
  try {
    for (;;) {
      const target = switches.desired.get(pluginId);
      const request = switches.requests.get(pluginId);
      if (target === undefined || request === undefined) return;
      if (target === switches.applied.get(pluginId)) {
        await refresh();
        if (switches.desired.get(pluginId) !== target) continue;
        settle(pluginId);
        return;
      }
      let jobId: string | null;
      try {
        jobId = await request.apply(target);
      } catch (error) {
        settle(pluginId);
        request.onFailed(error);
        return;
      }
      if (
        jobId !== null &&
        (await waitForInstallJob(queryClient, jobId)) !== "succeeded"
      ) {
        settle(pluginId);
        await refresh();
        return;
      }
      switches.applied.set(pluginId, target);
    }
  } finally {
    switches.running.delete(pluginId);
  }
}

export function useOnboardingPluginSwitches(): OnboardingPluginSwitches {
  const queryClient = useQueryClient();
  const [desired, setDesired] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const desiredRef = useRef(new Map<string, boolean>());
  const appliedRef = useRef(new Map<string, boolean>());
  const requestsRef = useRef(new Map<string, PluginSwitchRequest>());
  const runningRef = useRef(new Set<string>());

  const settle = useCallback((pluginId: string) => {
    desiredRef.current.delete(pluginId);
    appliedRef.current.delete(pluginId);
    setDesired(new Map(desiredRef.current));
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshPluginCatalogSearch({ queryClient }).catch(() => undefined),
      invalidatePluginList({ queryClient }).catch(() => undefined),
    ]);
  }, [queryClient]);

  const drive = useCallback(
    (pluginId: string) =>
      drivePluginSwitch(
        pluginId,
        {
          desired: desiredRef.current,
          applied: appliedRef.current,
          requests: requestsRef.current,
          running: runningRef.current,
        },
        queryClient,
        refresh,
        settle,
      ),
    [queryClient, refresh, settle],
  );

  const set = useCallback(
    (request: PluginSwitchRequest) => {
      const { pluginId } = request;
      if (!appliedRef.current.has(pluginId)) {
        appliedRef.current.set(pluginId, request.serverEnabled);
      }
      requestsRef.current.set(pluginId, request);
      desiredRef.current.set(pluginId, request.enabled);
      setDesired(new Map(desiredRef.current));
      void drive(pluginId);
    },
    [drive],
  );

  const shown = useCallback(
    (pluginId: string, serverEnabled: boolean) =>
      desired.get(pluginId) ?? serverEnabled,
    [desired],
  );

  return { shown, set };
}
