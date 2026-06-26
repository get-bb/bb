import { useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Automation, AutomationRun } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useAutomationDetail,
  useAutomationRuns,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useRunAutomation,
} from "@/hooks/queries/automation-queries";
import { formatCronCadence } from "@/lib/format-schedule";
import {
  getAutomationsRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { cn } from "@/lib/utils";

const RUN_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatRunTimestamp(timestamp: number): string {
  return RUN_TIME_FORMATTER.format(new Date(timestamp));
}

function formatRunDuration(run: AutomationRun): string | null {
  if (run.finishedAt === null) {
    return null;
  }
  const seconds = (run.finishedAt - run.startedAt) / 1000;
  if (seconds < 0) {
    return null;
  }
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

/** A succeeded script run that produced no surfaced output reads as "silent". */
function isSilentRun(run: AutomationRun): boolean {
  return (
    run.status === "succeeded" &&
    run.runMode === "script" &&
    (run.output === null || run.output.trim().length === 0)
  );
}

interface RunStatusLabel {
  label: string;
  tone: "ok" | "fail" | "muted";
}

function getRunStatusLabel(run: AutomationRun): RunStatusLabel {
  switch (run.status) {
    case "running":
      return { label: "Running", tone: "muted" };
    case "failed":
      return { label: "Failed", tone: "fail" };
    case "skipped":
      return { label: "Skipped", tone: "muted" };
    case "succeeded":
      return isSilentRun(run)
        ? { label: "Succeeded · silent", tone: "muted" }
        : { label: "Succeeded", tone: "ok" };
    default: {
      const _exhaustive: never = run.status;
      return _exhaustive;
    }
  }
}

const RUN_STATUS_TONE_CLASS: Record<RunStatusLabel["tone"], string> = {
  ok: "text-foreground",
  fail: "text-destructive",
  muted: "text-muted-foreground",
};

function describeEnvironment(automation: Automation): string {
  const { environment } = automation;
  if (environment.type === "reuse") {
    return "Reuses an existing environment";
  }
  switch (environment.workspace.type) {
    case "personal":
      return "Personal workspace";
    case "managed-worktree":
      return "Managed worktree";
    case "unmanaged":
      return environment.workspace.path
        ? `Workspace: ${environment.workspace.path}`
        : "Unmanaged workspace";
    default: {
      const _exhaustive: never = environment.workspace;
      return _exhaustive;
    }
  }
}

function describeExecution(automation: Automation): string {
  const { execution } = automation;
  if (execution.mode === "agent") {
    return `Agent · ${execution.providerId}/${execution.model} · ${execution.permissionMode}`;
  }
  const interpreter = execution.interpreter ?? "bash";
  const target = execution.scriptFile ?? "inline script";
  const timeoutSeconds = Math.round(execution.timeoutMs / 1000);
  return `Script · ${interpreter} ${target} · ${timeoutSeconds}s timeout`;
}

interface RunRowProps {
  run: AutomationRun;
  projectId: string;
}

function RunRow({ run, projectId }: RunRowProps) {
  const status = getRunStatusLabel(run);
  const duration = formatRunDuration(run);
  const silent = isSilentRun(run);
  const showOutput =
    run.runMode === "script" &&
    (run.output !== null || run.error !== null || silent);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className={cn("font-medium", RUN_STATUS_TONE_CLASS[status.tone])}>
          {status.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRunTimestamp(run.startedAt)}
          {duration ? ` · ${duration}` : ""}
        </span>
        {run.runMode === "agent" && run.threadId ? (
          <Link
            to={getThreadRoutePath({ projectId, threadId: run.threadId })}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            View thread
          </Link>
        ) : run.runMode === "script" && run.exitCode !== null ? (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            exit {run.exitCode}
          </span>
        ) : null}
      </div>
      {run.skipReason ? (
        <p className="border-t border-border-seam px-3 py-2 text-xs text-muted-foreground">
          {run.skipReason}
        </p>
      ) : null}
      {showOutput ? (
        <pre
          className={cn(
            "whitespace-pre-wrap border-t border-border-seam bg-surface-recessed px-3 py-2 font-mono text-xs leading-relaxed",
            run.error ? "text-destructive" : "text-foreground",
            silent && "italic text-subtle-foreground",
          )}
        >
          {run.error ??
            (silent
              ? "no output — silent gate, nothing surfaced"
              : (run.output ?? ""))}
        </pre>
      ) : null}
    </div>
  );
}

interface AutomationDetailContentProps {
  automation: Automation;
  runs: readonly AutomationRun[];
  runsLoading: boolean;
  runsError: boolean;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
  onDelete: () => void;
  actionsPending: boolean;
}

/**
 * Presentational body of the automation detail page: header, config summary,
 * action row, and run history. Split from the data-fetching container so it
 * renders without query/provider context in tests and stories.
 */
export function AutomationDetailContent({
  automation,
  runs,
  runsLoading,
  runsError,
  onPause,
  onResume,
  onRun,
  onDelete,
  actionsPending,
}: AutomationDetailContentProps) {
  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                automation.enabled ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
              {automation.name}
            </h1>
            {automation.execution.mode === "script" ? (
              <Pill variant="outline" className="shrink-0">
                Script
              </Pill>
            ) : null}
            {automation.origin === "agent" ? (
              <Pill variant="secondary" className="shrink-0">
                API
              </Pill>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatCronCadence(automation.trigger.cron)} ·{" "}
            {automation.trigger.timezone}
          </p>
          <p className="text-xs text-muted-foreground">
            {describeExecution(automation)}
          </p>
          <p className="text-xs text-muted-foreground">
            {describeEnvironment(automation)}
          </p>
          {automation.execution.mode === "agent" ? (
            <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {automation.execution.prompt}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {automation.enabled ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Pause"
              disabled={actionsPending}
              onClick={onPause}
            >
              <Icon name="Pause" className="size-4" />
              Pause
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Resume"
              disabled={actionsPending}
              onClick={onResume}
            >
              <Icon name="Play" className="size-4" />
              Resume
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Run now"
            disabled={actionsPending}
            onClick={onRun}
          >
            <Icon name="Zap" className="size-4" />
            Run now
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            aria-label="Delete automation"
            disabled={actionsPending}
            onClick={onDelete}
          >
            <Icon name="Trash2" className="size-4" />
            Delete
          </Button>
        </div>

        <section className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Run history
          </p>
          {runsError ? (
            <p className="text-sm text-destructive">Failed to load runs.</p>
          ) : runsLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : runs.length === 0 ? (
            <EmptyStatePanel className="py-6">No runs yet.</EmptyStatePanel>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  projectId={automation.projectId}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}

export function AutomationDetailView() {
  const params = useParams<{ projectId: string; automationId: string }>();
  const projectId = params.projectId ?? "";
  const automationId = params.automationId ?? "";
  const navigate = useNavigate();

  const detailQuery = useAutomationDetail(projectId, automationId);
  const runsQuery = useAutomationRuns(projectId, automationId);
  const pauseAutomation = usePauseAutomation();
  const resumeAutomation = useResumeAutomation();
  const runAutomation = useRunAutomation();
  const deleteAutomation = useDeleteAutomation();
  const deleteDialog = useDialogState<true>();
  const { mutate: pauseMutate } = pauseAutomation;
  const { mutate: resumeMutate } = resumeAutomation;
  const { mutate: runMutate } = runAutomation;
  const { mutate: deleteMutate } = deleteAutomation;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  const handlePause = useCallback(() => {
    pauseMutate({ projectId, automationId });
  }, [pauseMutate, projectId, automationId]);
  const handleResume = useCallback(() => {
    resumeMutate({ projectId, automationId });
  }, [resumeMutate, projectId, automationId]);
  const handleRun = useCallback(() => {
    runMutate({ projectId, automationId });
  }, [runMutate, projectId, automationId]);
  const confirmDelete = useCallback(() => {
    deleteMutate(
      { projectId, automationId },
      {
        onSuccess: () => {
          closeDeleteDialog();
          navigate(getAutomationsRoutePath(), { replace: true });
        },
      },
    );
  }, [deleteMutate, projectId, automationId, closeDeleteDialog, navigate]);

  const automation = detailQuery.data;
  const hasDetailError = detailQuery.isError && automation === undefined;
  const isDetailLoading =
    detailQuery.isFetching && automation === undefined && !hasDetailError;

  if (isDetailLoading) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </PageShell>
    );
  }

  if (hasDetailError || !automation) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-sm text-destructive">Failed to load automation.</p>
        </div>
      </PageShell>
    );
  }

  const runs = runsQuery.data?.runs ?? [];
  const hasRunsError = runsQuery.isError && runsQuery.data === undefined;
  const isRunsLoading =
    runsQuery.isFetching && runsQuery.data === undefined && !hasRunsError;
  const actionsPending =
    pauseAutomation.isPending ||
    resumeAutomation.isPending ||
    runAutomation.isPending ||
    deleteAutomation.isPending;

  return (
    <>
      <AutomationDetailContent
        automation={automation}
        runs={runs}
        runsLoading={isRunsLoading}
        runsError={hasRunsError}
        onPause={handlePause}
        onResume={handleResume}
        onRun={handleRun}
        onDelete={() => {
          openDeleteDialog(true);
        }}
        actionsPending={actionsPending}
      />
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        <ConfirmDeleteDialogContent
          title="Delete automation?"
          description={`"${automation.name}" and its run history will be permanently removed.`}
          confirmLabel="Delete"
          pending={deleteAutomation.isPending}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
        />
      </ConfirmDeleteDialog>
    </>
  );
}
