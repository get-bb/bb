import { Link } from "react-router-dom";
import type { HostDaemonWorkflowListing } from "@bb/host-daemon-contract";
import type { WorkflowRunResponse } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { workflowRunStatusPillVariant } from "@/components/workflow/workflow-run-status.js";
import { getWorkflowRunRoutePath } from "@/lib/app-route-paths";
import { formatRelativeTime } from "@/lib/relative-time";

/**
 * Definitions need the source host online (the daemon registry scan), so an
 * offline host or a sourceless project degrades to an explanatory message —
 * never error chrome, and never hiding the durable runs list below.
 */
export type ProjectWorkflowsDefinitionsState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; workflows: readonly HostDaemonWorkflowListing[] };

export type ProjectWorkflowsRunsState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; runs: readonly WorkflowRunResponse[] };

export interface ProjectWorkflowsPageProps {
  definitions: ProjectWorkflowsDefinitionsState;
  runs: ProjectWorkflowsRunsState;
  /** Reference time for relative run timestamps (injected for stories). */
  now: number;
  onRunWorkflow: (workflow: HostDaemonWorkflowListing) => void;
}

interface WorkflowDefinitionRowProps {
  workflow: HostDaemonWorkflowListing;
  onRun: () => void;
}

function WorkflowDefinitionRow({ workflow, onRun }: WorkflowDefinitionRowProps) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {workflow.name}
        </span>
        <Pill variant="outline" className="shrink-0">
          {workflow.tier}
        </Pill>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          onClick={onRun}
        >
          Run
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {workflow.description}
      </p>
      {workflow.whenToUse ? (
        <p className="mt-1 text-xs text-subtle-foreground">
          When to use: {workflow.whenToUse}
        </p>
      ) : null}
    </div>
  );
}

interface WorkflowRunListRowProps {
  run: WorkflowRunResponse;
  now: number;
}

function WorkflowRunListRow({ run, now }: WorkflowRunListRowProps) {
  return (
    <Link
      to={getWorkflowRunRoutePath(run.id)}
      className="flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-state-hover"
    >
      <span className="min-w-0 flex-1 truncate text-foreground">
        {run.workflowName}
      </span>
      <Pill variant={workflowRunStatusPillVariant(run.status)} className="shrink-0">
        {run.status}
      </Pill>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatRelativeTime({ timestamp: run.createdAt, now })}
      </span>
    </Link>
  );
}

export function ProjectWorkflowsPage({
  definitions,
  runs,
  now,
  onRunWorkflow,
}: ProjectWorkflowsPageProps) {
  return (
    <PageShell>
      <div className="flex flex-col gap-4 pt-3">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Workflows</h2>
          {definitions.kind === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading workflows…</p>
          ) : definitions.kind === "unavailable" ? (
            <EmptyStatePanel>{definitions.message}</EmptyStatePanel>
          ) : definitions.workflows.length === 0 ? (
            <EmptyStatePanel>
              No workflows yet. Agents (and humans) add them under{" "}
              <code className="font-mono text-xs">.bb/workflows</code> in the
              project checkout.
            </EmptyStatePanel>
          ) : (
            <div className="flex flex-col gap-1">
              {definitions.workflows.map((workflow) => (
                <WorkflowDefinitionRow
                  key={`${workflow.tier}:${workflow.name}`}
                  workflow={workflow}
                  onRun={() => onRunWorkflow(workflow)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Recent runs</h2>
          {runs.kind === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading runs…</p>
          ) : runs.kind === "unavailable" ? (
            <EmptyStatePanel>{runs.message}</EmptyStatePanel>
          ) : runs.runs.length === 0 ? (
            <EmptyStatePanel>No workflow runs yet.</EmptyStatePanel>
          ) : (
            <div className="flex flex-col gap-0.5">
              {runs.runs.map((run) => (
                <WorkflowRunListRow key={run.id} run={run} now={now} />
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
