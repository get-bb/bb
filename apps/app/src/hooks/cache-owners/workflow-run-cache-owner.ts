import type { QueryClient } from "@tanstack/react-query";
import type { WorkflowRunResponse } from "@bb/server-contract";
import {
  allWorkflowRunsQueryKeyPrefix,
  workflowRunQueryKey,
  workflowRunsQueryKey,
} from "../queries/query-keys";

interface WorkflowRunLifecycleActionArgs {
  queryClient: QueryClient;
  runId: string;
}

/**
 * Refresh run projections after a user lifecycle action (cancel/resume).
 * Status advances server-side — sometimes only after a daemon ack — so the
 * owner invalidates instead of patching cached rows; realtime `run-updated`
 * messages cover the later transitions.
 */
export function applyWorkflowRunLifecycleActionResult({
  queryClient,
  runId,
}: WorkflowRunLifecycleActionArgs): void {
  queryClient.invalidateQueries({ queryKey: workflowRunQueryKey(runId) });
  queryClient.invalidateQueries({ queryKey: allWorkflowRunsQueryKeyPrefix() });
}

interface WorkflowRunArchiveResultArgs {
  queryClient: QueryClient;
}

/**
 * Refresh run lists after a user archive: the run drops out of every list
 * surface server-side but stays reachable by id, so the cached detail row
 * remains valid.
 */
export function applyWorkflowRunArchiveResult({
  queryClient,
}: WorkflowRunArchiveResultArgs): void {
  queryClient.invalidateQueries({ queryKey: allWorkflowRunsQueryKeyPrefix() });
}

/**
 * Apply a user delete: the run is gone from lists and 404s by id, so drop the
 * cached detail row instead of inviting a refetch that can only fail.
 */
export function applyWorkflowRunDeleteResult({
  queryClient,
  runId,
}: WorkflowRunLifecycleActionArgs): void {
  queryClient.removeQueries({ queryKey: workflowRunQueryKey(runId) });
  queryClient.invalidateQueries({ queryKey: allWorkflowRunsQueryKeyPrefix() });
}

interface WorkflowRunCreateResultArgs {
  queryClient: QueryClient;
  run: WorkflowRunResponse;
}

/**
 * Apply a successful launch: seed the run detail cache with the created row
 * (the launcher navigates straight to the run page, which can render without
 * a refetch) and refresh the owning project's run list.
 */
export function applyWorkflowRunCreateResult({
  queryClient,
  run,
}: WorkflowRunCreateResultArgs): void {
  queryClient.setQueryData(workflowRunQueryKey(run.id), run);
  queryClient.invalidateQueries({
    queryKey: workflowRunsQueryKey(run.projectId),
  });
}
