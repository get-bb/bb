// bb-plugin-automations — the frontend bundle.
//
// A single navPanel "Automations" that replaces the kernel's Automations
// views. The panel root lists every automation across projects (rpc
// automations.overview); the detail subPath (/:projectId/:automationId)
// shows one automation's full config plus its cursor-paginated run history.
// Realtime "automations" signals refetch in place. Creation/editing is
// deliberately absent — parity with the kernel, where automations are made
// via the CLI or by agents.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner";
import type {
  AutomationExecution,
  AutomationResponse,
  AutomationRunListResponse,
  AutomationRunResponse,
  AutomationsOverviewResponse,
} from "@/src/rpc-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import {
  formatAutomationTrigger,
  formatScheduleRunTime,
  formatScheduleStatusLabel,
  isCompletedOneShotAutomation,
} from "@/lib/format-schedule";

const PANEL_PATH = "automations";
const PERSONAL_PROJECT_ID = "proj_personal";

type OverviewEntry = AutomationsOverviewResponse["automations"][number];

// ---------------------------------------------------------------------------
// rpc boundary — the backend validates every response with zod, so the wire
// shape is trusted; narrow with a single cast at the call site.
// ---------------------------------------------------------------------------

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Sub-routing: the panel owns /plugins/automations/automations/*. The root
// ("") is the overview; "<projectId>/<automationId>" is the detail view.
// ---------------------------------------------------------------------------

interface DetailRoute {
  projectId: string;
  automationId: string;
}

function parseSubPath(subPath: string): DetailRoute | null {
  const parts = subPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 2) {
    return { projectId: parts[0], automationId: parts[1] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data hooks. Each refetches on the "automations" realtime channel; the
// payload carries { projectId, kind } — mirror the kernel cache-effects and
// refetch on the relevant kind.
// ---------------------------------------------------------------------------

interface AutomationSignal {
  projectId: string;
  kind: "automations-changed" | "automation-runs-changed";
}

function asSignal(payload: unknown): AutomationSignal | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as { projectId?: unknown; kind?: unknown };
  if (
    typeof record.projectId !== "string" ||
    (record.kind !== "automations-changed" &&
      record.kind !== "automation-runs-changed")
  ) {
    return null;
  }
  return { projectId: record.projectId, kind: record.kind };
}

function useOverview(): {
  entries: OverviewEntry[] | null;
  error: string | null;
} {
  const rpc = useRpc();
  const [state, setState] = useState<{
    entries: OverviewEntry[] | null;
    error: string | null;
  }>({ entries: null, error: null });
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    rpc.call("automations_overview").then(
      (result) => {
        const data = result as AutomationsOverviewResponse;
        setState({ entries: data.automations, error: null });
      },
      (error: unknown) => setState({ entries: null, error: errorText(error) }),
    );
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useEffect(
    () => () => {
      if (refetchTimerRef.current !== null) {
        clearTimeout(refetchTimerRef.current);
      }
    },
    [],
  );
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current !== null) return;
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      refetch();
    }, 75);
  }, [refetch]);
  // Any create/update/pause/resume/run/delete or run-completion touches the
  // overview (rows show last-run status), so refetch on either kind.
  useRealtime("automations", (payload) => {
    if (asSignal(payload) !== null) scheduleRefetch();
  });
  return state;
}

function useAutomation(route: DetailRoute): {
  automation: AutomationResponse | null;
  error: string | null;
  missing: boolean;
} {
  const rpc = useRpc();
  const { projectId, automationId } = route;
  const [state, setState] = useState<{
    automation: AutomationResponse | null;
    error: string | null;
    missing: boolean;
  }>({ automation: null, error: null, missing: false });

  const refetch = useCallback(() => {
    rpc.call("automations_get", { projectId, automationId }).then(
      (result) => {
        const automation = result as AutomationResponse | null;
        setState({
          automation: automation ?? null,
          error: null,
          missing: automation === null,
        });
      },
      (error: unknown) =>
        setState({ automation: null, error: errorText(error), missing: false }),
    );
  }, [rpc, projectId, automationId]);

  useEffect(() => {
    setState({ automation: null, error: null, missing: false });
    refetch();
  }, [refetch]);
  useRealtime("automations", (payload) => {
    const signal = asSignal(payload);
    if (signal !== null && signal.projectId === projectId) refetch();
  });
  return state;
}

interface RunsState {
  runs: AutomationRunResponse[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

function useRuns(route: DetailRoute): RunsState & { loadMore: () => void } {
  const rpc = useRpc();
  const { projectId, automationId } = route;
  const [state, setState] = useState<RunsState>({
    runs: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  // Guard concurrent loadMore + refetch races: only the latest first-page
  // load is allowed to replace the list.
  const requestRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  const loadFirstPage = useCallback(() => {
    const requestId = ++requestRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    rpc.call("automations_runs", { projectId, automationId }).then(
      (result) => {
        if (requestRef.current !== requestId) return;
        const page = result as AutomationRunListResponse;
        setState({
          runs: page.runs,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        });
      },
      (error: unknown) => {
        if (requestRef.current !== requestId) return;
        setState({
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: errorText(error),
        });
      },
    );
  }, [rpc, projectId, automationId]);

  const loadMore = useCallback(() => {
    if (
      state.nextCursor === null ||
      state.loadingMore ||
      loadMoreInFlightRef.current
    ) {
      return;
    }
    const cursor = state.nextCursor;
    const requestId = requestRef.current;
    loadMoreInFlightRef.current = true;
    setState((prev) => ({ ...prev, loadingMore: true }));
    rpc.call("automations_runs", { projectId, automationId, cursor }).then(
      (result) => {
        if (requestRef.current !== requestId) return;
        const page = result as AutomationRunListResponse;
        setState((current) => ({
          ...current,
          runs: [...current.runs, ...page.runs],
          nextCursor: page.nextCursor,
          loadingMore: false,
        }));
      },
      (error: unknown) => {
        if (requestRef.current !== requestId) return;
        toast.error(errorText(error));
        setState((current) => ({ ...current, loadingMore: false }));
      },
    ).finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, [rpc, projectId, automationId, state.nextCursor, state.loadingMore]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);
  // A completed/started run (automation-runs-changed) for this project
  // refreshes the first page in place.
  useRealtime("automations", (payload) => {
    const signal = asSignal(payload);
    if (
      signal !== null &&
      signal.kind === "automation-runs-changed" &&
      signal.projectId === projectId
    ) {
      loadFirstPage();
    }
  });
  return { ...state, loadMore };
}

// ---------------------------------------------------------------------------
// Mutations — pause/resume/run/delete all take { projectId, automationId }.
// ---------------------------------------------------------------------------

function useMutations() {
  const rpc = useRpc();
  const call = useCallback(
    (method: string, route: DetailRoute) =>
      rpc.call(method, route),
    [rpc],
  );
  return {
    pause: (route: DetailRoute) => call("automations_pause", route),
    resume: (route: DetailRoute) => call("automations_resume", route),
    run: (route: DetailRoute) => call("automations_run", route),
    delete: (route: DetailRoute) => call("automations_delete", route),
  };
}

function routeOf(automation: AutomationResponse): DetailRoute {
  return { projectId: automation.projectId, automationId: automation.id };
}

// ---------------------------------------------------------------------------
// Formatting helpers (run history) — ported from the kernel detail view.
// ---------------------------------------------------------------------------

function formatRunTimestamp(timestamp: number): string {
  return formatScheduleRunTime(timestamp);
}

function formatRunDuration(run: AutomationRunResponse): string | null {
  if (run.finishedAt === null) return null;
  const seconds = (run.finishedAt - run.startedAt) / 1000;
  if (seconds < 0) return null;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

interface RunStatusLabel {
  label: string;
  tone: "ok" | "fail" | "muted";
}

function getRunStatusLabel(run: AutomationRunResponse): RunStatusLabel {
  switch (run.status) {
    case "running":
      return { label: "Running", tone: "muted" };
    case "failed":
      return { label: "Failed", tone: "fail" };
    case "skipped":
      return { label: "Skipped", tone: "muted" };
    case "succeeded":
      return { label: "Succeeded", tone: "ok" };
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

function describeExecution(execution: AutomationExecution): string {
  if (execution.mode === "agent") {
    return `Agent · ${execution.providerId}/${execution.model} · ${execution.permissionMode}`;
  }
  const interpreter = execution.interpreter ?? "bash";
  const target = execution.scriptFile ?? "inline script";
  const timeoutSeconds = Math.round(execution.timeoutMs / 1000);
  return `Script · ${interpreter} ${target} · ${timeoutSeconds}s timeout`;
}

function describeEnvironment(execution: AutomationExecution): string | null {
  if (execution.mode !== "agent") return null;
  const environment = execution.environment;
  switch (environment.type) {
    case "reuse":
      return "Reuses an existing environment";
    case "project-default":
      return "Project default environment";
    case "host":
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
    default: {
      const _exhaustive: never = environment;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------------

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        enabled ? "bg-success" : "bg-muted-foreground/50",
      )}
    />
  );
}

function AutomationBadges({ automation }: { automation: AutomationResponse }) {
  return (
    <>
      {automation.execution.mode === "script" ? (
        <Badge variant="outline" className="shrink-0 font-normal">
          Script
        </Badge>
      ) : null}
      {automation.origin === "agent" ? (
        <Badge variant="secondary" className="shrink-0 font-normal">
          API
        </Badge>
      ) : null}
    </>
  );
}

/** Confirm-before-delete dialog, controlled by the caller. */
function DeleteAutomationDialog({
  open,
  onOpenChange,
  name,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete automation?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{name}&rdquo; and its run history will be permanently
            removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={(event) => {
              // Keep the dialog mounted until the mutation resolves.
              event.preventDefault();
              onConfirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// List view (panel root): the cross-project overview.
// ---------------------------------------------------------------------------

interface StatusGroup {
  status: "active" | "paused";
  label: string;
  entries: OverviewEntry[];
}

function groupByStatus(entries: readonly OverviewEntry[]): StatusGroup[] {
  const active: OverviewEntry[] = [];
  const paused: OverviewEntry[] = [];
  for (const entry of entries) {
    (entry.automation.enabled ? active : paused).push(entry);
  }
  const groups: StatusGroup[] = [];
  if (active.length > 0)
    groups.push({ status: "active", label: "Active", entries: active });
  if (paused.length > 0)
    groups.push({ status: "paused", label: "Paused", entries: paused });
  return groups;
}

function OverviewRow({
  entry,
  onNavigate,
  onAction,
  onDelete,
}: {
  entry: OverviewEntry;
  onNavigate: (route: DetailRoute) => void;
  onAction: (method: "pause" | "resume" | "run", route: DetailRoute) => void;
  onDelete: (entry: OverviewEntry) => void;
}) {
  const navigate = useBbNavigate();
  const { automation, project } = entry;
  const route = routeOf(automation);
  const projectLabel =
    project.id === PERSONAL_PROJECT_ID ? null : project.name;
  const completedOneShot = isCompletedOneShotAutomation({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
  const lastRunStatus = automation.lastRunStatus;

  return (
    <div className="group flex flex-col gap-1 rounded-md px-3 py-2 transition-colors hover:bg-state-hover">
      <div className="flex items-center gap-2 text-sm">
        <StatusDot enabled={automation.enabled} />
        <button
          type="button"
          onClick={() => onNavigate(route)}
          className="min-w-0 flex-1 truncate text-left hover:underline"
        >
          {automation.name}
        </button>
        {projectLabel ? (
          <Badge variant="outline" className="shrink-0 font-normal">
            {projectLabel}
          </Badge>
        ) : null}
        <AutomationBadges automation={automation} />
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatScheduleStatusLabel({
            enabled: automation.enabled,
            nextRunAt: automation.nextRunAt,
            trigger: automation.trigger,
            runCount: automation.runCount,
          })}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 rounded-md p-0 text-muted-foreground"
              aria-label={`${automation.name} actions`}
            >
              <Icon name="MoreHorizontal" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
            mobileTitle={`${automation.name} actions`}
          >
            {automation.enabled ? (
              <DropdownMenuItem onSelect={() => onAction("pause", route)}>
                Pause
              </DropdownMenuItem>
            ) : completedOneShot ? null : (
              <DropdownMenuItem onSelect={() => onAction("resume", route)}>
                Resume
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onAction("run", route)}>
              Run now
            </DropdownMenuItem>
            {automation.lastRunThreadId ? (
              <DropdownMenuItem
                onSelect={() => navigate.toThread(automation.lastRunThreadId!)}
              >
                View last thread
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(entry)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-2 pl-[calc(0.375rem+0.5rem)] text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {formatAutomationTrigger(automation.trigger)}
        </span>
        {lastRunStatus !== null ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              Last run {lastRunStatus}
              {automation.lastRunAt !== null
                ? ` ${formatRunTimestamp(automation.lastRunAt)}`
                : ""}
            </span>
          </>
        ) : null}
        {automation.lastRunThreadId ? (
          <button
            type="button"
            onClick={() => navigate.toThread(automation.lastRunThreadId!)}
            className="ml-auto shrink-0 hover:text-foreground hover:underline"
          >
            View thread
          </button>
        ) : null}
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-2 px-3 py-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function OverviewView({
  onOpenDetail,
}: {
  onOpenDetail: (route: DetailRoute) => void;
}) {
  const { entries, error } = useOverview();
  const mutations = useMutations();
  const [deleteTarget, setDeleteTarget] = useState<OverviewEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const runAction = useCallback(
    (method: "pause" | "resume" | "run", route: DetailRoute) => {
      const label =
        method === "run" ? "run" : method === "pause" ? "pause" : "resume";
      mutations[method](route).then(
        () => {
          if (method === "run") toast.success("Run started");
        },
        (rpcError: unknown) =>
          toast.error(`Failed to ${label} automation: ${errorText(rpcError)}`),
      );
    },
    [mutations],
  );

  const confirmDelete = useCallback(() => {
    if (deleteTarget === null) return;
    setDeleting(true);
    mutations
      .delete(routeOf(deleteTarget.automation))
      .then(
        () => {
          toast.success("Automation deleted");
          setDeleteTarget(null);
        },
        (rpcError: unknown) =>
          toast.error(`Failed to delete automation: ${errorText(rpcError)}`),
      )
      .finally(() => setDeleting(false));
  }, [deleteTarget, mutations]);

  const groups = useMemo(
    () => (entries === null ? [] : groupByStatus(entries)),
    [entries],
  );

  let body: React.ReactNode;
  if (error !== null) {
    body = <p className="text-sm text-destructive">Failed to load automations.</p>;
  } else if (entries === null) {
    body = <OverviewSkeleton />;
  } else if (entries.length === 0) {
    body = (
      <EmptyState message="No automations yet. Create one with `bb automations create` or by asking an agent." />
    );
  } else {
    body = (
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.status}>
            <p className="px-3 text-xs font-medium uppercase text-muted-foreground">
              {group.label}
            </p>
            <div className="mt-1.5 space-y-1">
              {group.entries.map((entry) => (
                <OverviewRow
                  key={entry.automation.id}
                  entry={entry}
                  onNavigate={onOpenDetail}
                  onAction={runAction}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {body}
      <DeleteAutomationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        name={deleteTarget?.automation.name ?? ""}
        pending={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view: one automation's config, actions, and run history.
// ---------------------------------------------------------------------------

function RunRow({
  run,
  onOpenThread,
}: {
  run: AutomationRunResponse;
  onOpenThread: (threadId: string) => void;
}) {
  const status = getRunStatusLabel(run);
  const duration = formatRunDuration(run);
  const hasOutput =
    run.runMode === "script" &&
    (run.output !== null || run.error !== null);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className={cn("font-medium", RUN_STATUS_TONE_CLASS[status.tone])}>
          {status.label}
        </span>
        <Badge variant="outline" className="shrink-0 font-normal capitalize">
          {run.trigger}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatRunTimestamp(run.startedAt)}
          {duration ? ` · ${duration}` : ""}
        </span>
        {run.runMode === "agent" && run.threadId ? (
          <button
            type="button"
            onClick={() => onOpenThread(run.threadId!)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            View thread
          </button>
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
      {hasOutput ? (
        <div className="border-t border-border-seam">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            <Icon
              name={expanded ? "ChevronDown" : "ChevronRight"}
              className="size-3.5"
            />
            {run.error ? "Error output" : "Output"}
          </button>
          {expanded ? (
            <pre
              className={cn(
                "whitespace-pre-wrap border-t border-border-seam bg-surface-recessed px-3 py-2 font-mono text-xs leading-relaxed",
                run.error ? "text-destructive" : "text-foreground",
              )}
            >
              {run.error ?? run.output ?? ""}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailView({
  route,
  onBack,
}: {
  route: DetailRoute;
  onBack: () => void;
}) {
  const navigate = useBbNavigate();
  const { automation, error, missing } = useAutomation(route);
  const runsState = useRuns(route);
  const mutations = useMutations();
  const [actionPending, setActionPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openThread = useCallback(
    (threadId: string) => navigate.toThread(threadId),
    [navigate],
  );

  const runAction = useCallback(
    (method: "pause" | "resume" | "run") => {
      setActionPending(true);
      mutations[method](route)
        .then(
          () => {
            if (method === "run") toast.success("Run started");
          },
          (rpcError: unknown) =>
            toast.error(`Failed to ${method} automation: ${errorText(rpcError)}`),
        )
        .finally(() => setActionPending(false));
    },
    [mutations, route],
  );

  const confirmDelete = useCallback(() => {
    setDeleting(true);
    mutations
      .delete(route)
      .then(
        () => {
          toast.success("Automation deleted");
          setDeleteOpen(false);
          onBack();
        },
        (rpcError: unknown) =>
          toast.error(`Failed to delete automation: ${errorText(rpcError)}`),
      )
      .finally(() => setDeleting(false));
  }, [mutations, route, onBack]);

  const backButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 h-7 gap-1.5 px-2 text-muted-foreground"
      onClick={onBack}
    >
      <Icon name="ChevronLeft" className="size-4" />
      Automations
    </Button>
  );

  if (error !== null || missing) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {backButton}
        <p className="text-sm text-destructive">
          {missing ? "Automation not found." : "Failed to load automation."}
        </p>
      </div>
    );
  }

  if (automation === null) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {backButton}
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const completedOneShot = isCompletedOneShotAutomation({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
  const environmentLabel = describeEnvironment(automation.execution);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {backButton}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusDot enabled={automation.enabled} />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
            {automation.name}
          </h1>
          <AutomationBadges automation={automation} />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatAutomationTrigger(automation.trigger)}
        </p>
        <p className="text-xs text-muted-foreground">
          {describeExecution(automation.execution)}
        </p>
        {environmentLabel ? (
          <p className="text-xs text-muted-foreground">{environmentLabel}</p>
        ) : null}
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
            disabled={actionPending}
            onClick={() => runAction("pause")}
          >
            <Icon name="Pause" className="size-4" />
            Pause
          </Button>
        ) : completedOneShot ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actionPending}
            onClick={() => runAction("resume")}
          >
            <Icon name="Play" className="size-4" />
            Resume
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={actionPending}
          onClick={() => runAction("run")}
        >
          <Icon name="Zap" className="size-4" />
          Run now
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={actionPending}
          onClick={() => setDeleteOpen(true)}
        >
          <Icon name="Trash2" className="size-4" />
          Delete
        </Button>
      </div>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Run history
        </p>
        {runsState.error !== null ? (
          <p className="text-sm text-destructive">Failed to load runs.</p>
        ) : runsState.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : runsState.runs.length === 0 ? (
          <EmptyState message="No runs yet." />
        ) : (
          <div className="space-y-2">
            {runsState.runs.map((run) => (
              <RunRow key={run.id} run={run} onOpenThread={openThread} />
            ))}
            {runsState.nextCursor !== null ? (
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={runsState.loadingMore}
                  onClick={runsState.loadMore}
                >
                  {runsState.loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <DeleteAutomationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        name={automation.name}
        pending={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel root — routes between overview and detail by subPath.
// ---------------------------------------------------------------------------

function AutomationsPanel({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const route = useMemo(() => parseSubPath(subPath), [subPath]);

  const openDetail = useCallback(
    (next: DetailRoute) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: `${next.projectId}/${next.automationId}`,
      });
    },
    [navigate],
  );
  const backToList = useCallback(() => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
  }, [navigate]);

  if (route !== null) {
    return <DetailView route={route} onBack={backToList} />;
  }
  return <OverviewView onOpenDetail={openDetail} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "automations",
    title: "Automations",
    icon: "Repeat",
    path: PANEL_PATH,
    component: AutomationsPanel,
  });
});
