import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isTerminalWorkflowRunStatus } from "@bb/domain";
import type { WorkflowRunEventsResponse } from "@bb/server-contract";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  useCancelWorkflowRun,
  useResumeWorkflowRun,
} from "@/hooks/mutations/workflow-run-mutations";
import { useHost } from "@/hooks/queries/host-queries";
import {
  useWorkflowRun,
  useWorkflowRunEvents,
} from "@/hooks/queries/workflow-queries";
import { HttpError } from "@/lib/api";
import {
  getWorkflowRunAgentRoutePath,
  getWorkflowRunRoutePath,
} from "@/lib/route-paths";
import { wsManager } from "@/lib/ws";
import { WorkflowAgentTimeline } from "./WorkflowAgentTimeline";
import { WorkflowRunPage } from "./WorkflowRunPage";

/**
 * Preserved worktree branches, collected from the durable journal entries
 * (`agent/completed`/`agent/failed` payloads) — host-offline safe, since run
 * events live on the server.
 */
function collectWorktreeBranches(
  events: WorkflowRunEventsResponse | undefined,
): string[] {
  if (!events) {
    return [];
  }
  const branches = new Set<string>();
  for (const row of events) {
    const { event } = row;
    if (
      (event.type === "agent/completed" || event.type === "agent/failed") &&
      event.entry.worktreeBranch !== undefined
    ) {
      branches.add(event.entry.worktreeBranch);
    }
  }
  return [...branches];
}

function describeRunLoadError(error: unknown): string {
  if (error instanceof HttpError && error.status === 404) {
    return "Workflow run not found.";
  }
  return "Failed to load workflow run.";
}

/**
 * Agent selection is URL-driven via the `/agents/:agentIndex` sub-route so a
 * drill-in is linkable and survives reloads. A malformed index renders as no
 * selection rather than an error page.
 */
function parseAgentIndexParam(param: string | undefined): number | null {
  if (param === undefined) {
    return null;
  }
  const parsed = Number.parseInt(param, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function WorkflowRunView() {
  const { runId = "", agentIndex: agentIndexParam } = useParams<{
    agentIndex?: string;
    runId: string;
  }>();
  const navigate = useNavigate();
  const selectedAgentIndex = parseAgentIndexParam(agentIndexParam);

  // Workflow-run realtime is per-id by design (useWebSocket's entity-wide
  // list deliberately omits it): subscribe while the page is open so the
  // registry's run-updated/events-appended invalidations fire, and
  // unsubscribe on leave so the server hub does not leak the key.
  useEffect(() => {
    if (!runId) {
      return;
    }
    wsManager.subscribe("workflow-run", runId);
    return () => {
      wsManager.unsubscribe("workflow-run", runId);
    };
  }, [runId]);

  const runQuery = useWorkflowRun(runId);
  const run = runQuery.data;
  // The journal is read for preserved worktree branches only, which exist
  // solely in terminal agent journal entries. While the run is live the
  // snapshot drives everything on the page, and fetching the journal per
  // realtime batch would re-download every settled agent's full result
  // payload up to ~5x/second — so the query stays disabled until the run
  // leaves the live states (interrupted or terminal). Realtime
  // events-appended invalidations keep it fresh for non-live runs (e.g.
  // late-spooled events landing on an interrupted run).
  const eventsQuery = useWorkflowRunEvents({
    enabled:
      run !== undefined &&
      (run.status === "interrupted" ||
        isTerminalWorkflowRunStatus(run.status)),
    runId,
  });
  const hostQuery = useHost({ hostId: run?.hostId });
  const cancelRun = useCancelWorkflowRun();
  const resumeRun = useResumeWorkflowRun();

  const worktreeBranches = useMemo(
    () => collectWorktreeBranches(eventsQuery.data),
    [eventsQuery.data],
  );

  if (!run) {
    return (
      <PageShell>
        <div className="pt-3">
          {runQuery.isError ? (
            <EmptyStatePanel>
              {describeRunLoadError(runQuery.error)}
            </EmptyStatePanel>
          ) : (
            <p className="text-sm text-muted-foreground">
              Loading workflow run…
            </p>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <WorkflowRunPage
      host={hostQuery.data ?? null}
      isCancelPending={cancelRun.isPending}
      isResumePending={resumeRun.isPending}
      onCancel={() => cancelRun.mutate({ runId: run.id })}
      onCloseAgent={() => {
        navigate(getWorkflowRunRoutePath(run.id));
      }}
      onResume={() => resumeRun.mutate({ runId: run.id })}
      onSelectAgent={(agentIndex) => {
        navigate(getWorkflowRunAgentRoutePath({ agentIndex, runId: run.id }));
      }}
      renderAgentTimeline={({ agentIndex, isAgentLive }) => (
        <WorkflowAgentTimeline
          agentIndex={agentIndex}
          isAgentLive={isAgentLive}
          runId={run.id}
        />
      )}
      run={run}
      selectedAgentIndex={selectedAgentIndex}
      worktreeBranches={worktreeBranches}
    />
  );
}
