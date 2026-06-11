import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isLocalPathProjectSource } from "@bb/domain";
import {
  WorkflowRunDialog,
  type WorkflowRunDialogTarget,
  type WorkflowRunLaunchInput,
} from "@/components/dialogs/WorkflowRunDialog";
import { PageShell } from "@/components/ui/page-shell.js";
import { useCreateWorkflowRun } from "@/hooks/mutations/workflow-run-mutations";
import { useHosts } from "@/hooks/queries/host-queries";
import {
  stripProjectThreads,
  useSidebarNavigation,
} from "@/hooks/queries/project-queries";
import {
  useWorkflowRuns,
  useWorkflows,
} from "@/hooks/queries/workflow-queries";
import { useDialogState } from "@/hooks/useDialogState";
import { HttpError } from "@/lib/api";
import { getWorkflowRunRoutePath } from "@/lib/route-paths";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { wsManager } from "@/lib/ws";
import {
  ProjectWorkflowsPage,
  type ProjectWorkflowsDefinitionsState,
  type ProjectWorkflowsRunsState,
} from "./ProjectWorkflowsPage";

const LAUNCH_FALLBACK_ERROR_MESSAGE = "Failed to launch workflow run.";

function describeWorkflowListError(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 502 || error.status === 504) {
      return "Source host is offline — workflow definitions are unavailable.";
    }
    if (error.status === 409) {
      return "This project has no default source. Add one in project settings to list workflows.";
    }
  }
  return "Failed to load workflows.";
}

export function ProjectWorkflowsView() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Workflow-run realtime is opt-in by design (the global entity list omits
  // it). The tab subscribes entity-wide while open so the recent-runs status
  // pills track live runs through the registry's debounced `run-updated`
  // invalidations, and unsubscribes on leave so the hub key never leaks.
  useEffect(() => {
    wsManager.subscribe("workflow-run");
    return () => {
      wsManager.unsubscribe("workflow-run");
    };
  }, []);
  const sidebarNavigationQuery = useSidebarNavigation();
  const project = useMemo(() => {
    const match = sidebarNavigationQuery.data?.projects.find(
      (candidate) => candidate.id === projectId,
    );
    return match ? stripProjectThreads(match) : undefined;
  }, [projectId, sidebarNavigationQuery.data]);
  const projectSources = project?.sources;
  const sources = useMemo(() => projectSources ?? [], [projectSources]);
  const { data: hosts = [] } = useHosts();

  // The launchable hosts are exactly the ones holding a local-path source.
  // The >1-hosts gate derives from the sources themselves (synchronously
  // available on the project row) — never from the async hosts query, whose
  // unresolved window would silently hide the host select and launch a
  // multi-host project on the default source without offering the choice.
  const sourceHostIds = useMemo(
    () => [
      ...new Set(
        sources
          .filter(isLocalPathProjectSource)
          .map((source) => source.hostId),
      ),
    ],
    [sources],
  );
  const defaultHostId = useMemo(
    () => sources.find((source) => source.isDefault)?.hostId ?? null,
    [sources],
  );

  // The tab lists definitions from the project's default source; an explicit
  // host choice exists only at launch time (the dialog's host select).
  const workflowsQuery = useWorkflows(projectId);
  const runsQuery = useWorkflowRuns(projectId);

  const runDialog = useDialogState<WorkflowRunDialogTarget>();
  const createRun = useCreateWorkflowRun();

  if (!projectId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Project not found
        </p>
      </PageShell>
    );
  }

  const definitions: ProjectWorkflowsDefinitionsState = workflowsQuery.isPending
    ? { kind: "loading" }
    : workflowsQuery.isError
      ? {
          kind: "unavailable",
          message: describeWorkflowListError(workflowsQuery.error),
        }
      : { kind: "ready", workflows: workflowsQuery.data };

  const runs: ProjectWorkflowsRunsState = runsQuery.isPending
    ? { kind: "loading" }
    : runsQuery.isError
      ? { kind: "unavailable", message: "Failed to load workflow runs." }
      : { kind: "ready", runs: runsQuery.data };

  const handleLaunch = (input: WorkflowRunLaunchInput) => {
    createRun.mutate(
      {
        projectId,
        source: { type: "named", name: input.workflowName },
        clientRequestId: input.clientRequestId,
        ...(input.hostId !== undefined ? { hostId: input.hostId } : {}),
        ...(input.args !== undefined ? { args: input.args } : {}),
        ...(input.providerId !== undefined
          ? { providerId: input.providerId }
          : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.sandbox !== undefined ? { sandbox: input.sandbox } : {}),
        ...(input.budgetOutputTokens !== undefined
          ? { budgetOutputTokens: input.budgetOutputTokens }
          : {}),
      },
      {
        onSuccess: (run) => {
          runDialog.onClose();
          navigate(getWorkflowRunRoutePath(run.id));
        },
      },
    );
  };

  return (
    <>
      <ProjectWorkflowsPage
        definitions={definitions}
        now={Date.now()}
        onRunWorkflow={(workflow) => {
          // A stale failure from a previous launch attempt must not greet the
          // next dialog open.
          createRun.reset();
          runDialog.onOpen({ workflow });
        }}
        runs={runs}
      />
      <WorkflowRunDialog
        defaultHostId={defaultHostId}
        errorMessage={
          createRun.isError
            ? getMutationErrorMessage({
                error: createRun.error,
                fallbackMessage: LAUNCH_FALLBACK_ERROR_MESSAGE,
              })
            : null
        }
        hosts={hosts}
        onLaunch={handleLaunch}
        onOpenChange={runDialog.onOpenChange}
        pending={createRun.isPending}
        sourceHostIds={sourceHostIds}
        target={runDialog.target}
      />
    </>
  );
}
