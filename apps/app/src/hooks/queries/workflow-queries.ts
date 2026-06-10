import { useQuery } from "@tanstack/react-query";
import type { ThreadEventRow } from "@bb/domain";
import type {
  WorkflowListResponse,
  WorkflowRunEventsResponse,
  WorkflowRunListResponse,
  WorkflowRunResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  recentWorkflowRunsQueryKey,
  workflowRunAgentEventsQueryKey,
  workflowRunEventsQueryKey,
  workflowRunQueryKey,
  workflowRunsQueryKey,
  workflowsQueryKey,
  type WorkflowRunAgentEventsQueryIdentity,
} from "./query-keys";

/**
 * Cap for the sidebar's cross-project recent-runs list: enough history to be
 * useful without the sidebar scrolling forever once runs accumulate.
 */
const RECENT_WORKFLOW_RUNS_LIMIT = "20";

function requireWorkflowRunId(id: string, hookName: string): string {
  if (!id) {
    throw new Error(
      `${hookName}: workflow run id is required when query is enabled`,
    );
  }

  return id;
}

function requireProjectId(
  projectId: string | undefined,
  hookName: string,
): string {
  if (!projectId) {
    throw new Error(`${hookName}: projectId is required when query is enabled`);
  }

  return projectId;
}

/**
 * Workflow definitions across registry tiers from the project's default
 * source root. Listing requires the source host online, so callers map
 * 502/504 errors to a "host offline" state rather than error chrome.
 */
export function useWorkflows(projectId: string) {
  return useQuery<WorkflowListResponse>({
    queryKey: workflowsQueryKey(projectId),
    queryFn: () =>
      api.listWorkflows(requireProjectId(projectId, "useWorkflows")),
    enabled: Boolean(projectId),
  });
}

export function useWorkflowRuns(projectId: string) {
  return useQuery<WorkflowRunListResponse>({
    queryKey: workflowRunsQueryKey(projectId),
    queryFn: () =>
      api.listWorkflowRuns({
        projectId: requireProjectId(projectId, "useWorkflowRuns"),
      }),
    enabled: Boolean(projectId),
  });
}

/** Newest runs across all projects, capped, for the sidebar Workflows section. */
export function useRecentWorkflowRuns() {
  return useQuery<WorkflowRunListResponse>({
    queryKey: recentWorkflowRunsQueryKey(),
    queryFn: () => api.listWorkflowRuns({ limit: RECENT_WORKFLOW_RUNS_LIMIT }),
  });
}

export function useWorkflowRun(runId: string) {
  return useQuery<WorkflowRunResponse>({
    queryKey: workflowRunQueryKey(runId),
    queryFn: () =>
      api.getWorkflowRun(requireWorkflowRunId(runId, "useWorkflowRun")),
    enabled: Boolean(runId),
  });
}

export interface WorkflowRunEventsQueryArgs {
  /**
   * Whether the journal should be fetched at all. The run page disables this
   * while the run is live: the journal grows per agent settle and every
   * `agent/completed` payload carries the full untruncated resultText, so a
   * live-run refetch per realtime batch would re-download O(events) data up
   * to ~5x/second. Realtime `events-appended` invalidations still mark the
   * query stale, so flipping to enabled fetches fresh data exactly once.
   */
  enabled: boolean;
  runId: string;
}

export function useWorkflowRunEvents({
  enabled,
  runId,
}: WorkflowRunEventsQueryArgs) {
  return useQuery<WorkflowRunEventsResponse>({
    queryKey: workflowRunEventsQueryKey(runId),
    queryFn: () =>
      api.getWorkflowRunEvents(
        requireWorkflowRunId(runId, "useWorkflowRunEvents"),
      ),
    enabled: Boolean(runId) && enabled,
  });
}

/**
 * Per-agent provider-event log (1-based journal-stable `agentIndex`).
 * Liveness comes from the realtime `events-appended` invalidation of the
 * per-run agent-events prefix — mounted drill-ins refetch on the shared
 * debounce window, so no poll interval is needed.
 */
export function useWorkflowRunAgentEvents(
  identity: WorkflowRunAgentEventsQueryIdentity,
) {
  return useQuery<ThreadEventRow[]>({
    queryKey: workflowRunAgentEventsQueryKey(identity),
    queryFn: () =>
      api.getWorkflowRunAgentEvents({
        agentIndex: identity.agentIndex,
        runId: requireWorkflowRunId(
          identity.runId,
          "useWorkflowRunAgentEvents",
        ),
      }),
    enabled: Boolean(identity.runId),
  });
}
