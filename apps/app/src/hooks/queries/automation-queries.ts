import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Automation,
  AutomationRunListResponse,
  AutomationRunResponse,
  AutomationsOverviewResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { invalidateAutomationMutationQueries } from "@/hooks/cache-owners/automation-cache-effects";
import {
  useProjectListRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import {
  automationDetailQueryKey,
  automationRunsQueryKey,
  automationsQueryKey,
} from "./query-keys";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * Cross-project automations overview for the Automations view. Subscribes to the
 * project-list realtime channel so `automations-changed` /
 * `automation-runs-changed` notifications invalidate the overview, and to the
 * thread-list channel because rows render the spawning thread's title/state.
 */
export function useAutomations(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<AutomationsOverviewResponse>({
    queryKey: automationsQueryKey(),
    queryFn: ({ signal }) => api.listAutomations(signal),
    enabled,
  });
}

/**
 * Single automation record for the detail view. Subscribes to the same
 * project-list/thread-list realtime channels as {@link useAutomations} so a
 * pause/resume/run elsewhere keeps the open detail header live.
 */
export function useAutomationDetail(
  projectId: string,
  automationId: string,
  options?: QueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(projectId) && Boolean(automationId);
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<Automation>({
    queryKey: automationDetailQueryKey(projectId, automationId),
    queryFn: ({ signal }) =>
      api.getAutomation({ projectId, automationId, signal }),
    enabled,
  });
}

/**
 * Run history for the detail view. Shares the project-list/thread-list realtime
 * subscriptions so a completed run (`automation-runs-changed`) refreshes the
 * list without a manual reload.
 */
export function useAutomationRuns(
  projectId: string,
  automationId: string,
  options?: QueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(projectId) && Boolean(automationId);
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<AutomationRunListResponse>({
    queryKey: automationRunsQueryKey(projectId, automationId),
    queryFn: ({ signal }) =>
      api.listAutomationRuns({ projectId, automationId, signal }),
    enabled,
  });
}

interface AutomationMutationRequest {
  projectId: string;
  automationId: string;
}

export function usePauseAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorMessage: "Failed to pause automation." },
    mutationFn: (request: AutomationMutationRequest) =>
      api.pauseAutomation(request),
    onSuccess: (_data, variables) => {
      invalidateAutomationMutationQueries({ ...variables, queryClient });
    },
  });
}

export function useResumeAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorMessage: "Failed to resume automation." },
    mutationFn: (request: AutomationMutationRequest) =>
      api.resumeAutomation(request),
    onSuccess: (_data, variables) => {
      invalidateAutomationMutationQueries({ ...variables, queryClient });
    },
  });
}

export function useRunAutomation() {
  const queryClient = useQueryClient();

  return useMutation<AutomationRunResponse, Error, AutomationMutationRequest>({
    meta: { errorMessage: "Failed to run automation." },
    mutationFn: (request: AutomationMutationRequest) =>
      api.runAutomation(request),
    onSuccess: (_data, variables) => {
      invalidateAutomationMutationQueries({ ...variables, queryClient });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorMessage: "Failed to delete automation." },
    mutationFn: (request: AutomationMutationRequest) =>
      api.deleteAutomation(request),
    onSuccess: (_data, variables) => {
      invalidateAutomationMutationQueries({ ...variables, queryClient });
    },
  });
}
