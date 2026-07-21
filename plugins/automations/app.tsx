// bb-plugin-automations — the frontend bundle.
//
// A single navPanel "Automations" that replaces the kernel's Automations
// views. The panel root lists every automation across projects (rpc
// automations.overview); the detail subPath (/:projectId/:automationId)
// shows one automation's full config plus its cursor-paginated run history.
// Realtime "automations" signals refetch in place. Creation and editing start
// from chat with enough resource context for the agent to do the work.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { buildAutomationEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import type { automationRpcContract } from "./src/rpc.js";
import { toast } from "sonner";
import type {
  AutomationResponse,
  AutomationRunListResponse,
  AutomationRunResponse,
  AutomationsOverviewResponse,
} from "@/src/rpc-types";
import {
  AutomationDetailView,
  AutomationLifecycleControl,
  automationIconName,
  automationScheduleLabel,
} from "./detail-view";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import {
  RESOURCE_LIST_PAGE_SIZE,
  ResourcePagination,
  useResourcePagination,
} from "@bb/shared-ui/resource-pagination";
import { COARSE_POINTER_ICON_SIZE_SHRINK_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  ResourceBrowseGrid,
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceCreateButton,
  ResourceListPanel,
  ResourceListState,
  ResourceLocationMeta,
  ResourceMeta,
  ResourceMultiSelectMenu,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceTemplateBrowseCard,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  formatAutomationTrigger,
  formatOverviewScheduleMetadata,
  getOneShotLifecycle,
  oneShotLifecycleAllowsToggle,
} from "@/lib/format-schedule";

const PANEL_PATH = "automations";
const PERSONAL_PROJECT_ID = "proj_personal";

// Prefill text for the "Create via chat" entry point — an agent turns this
// into a real automation. Inlined here so the plugin bundle stays
// self-contained.
const CREATE_AUTOMATION_PROMPT = "Create a new bb automation to ";
const AUTOMATION_CREATE_TEMPLATES = [
  {
    label: "CI failure triage",
    icon: "AlertCircle",
    description:
      "runs every weekday morning, checks failed main-branch CI, and opens fixer threads only for new failures",
    prompt: `${CREATE_AUTOMATION_PROMPT}runs every weekday morning, checks failed main-branch CI, and opens fixer threads only for new failures.`,
  },
  {
    label: "Dependency drift",
    icon: "ElectricPlugs",
    description:
      "checks weekly for stale dependencies and opens an update thread when risk is low",
    prompt: `${CREATE_AUTOMATION_PROMPT}checks weekly for stale dependencies and opens an update thread when risk is low.`,
  },
  {
    label: "Release readiness",
    icon: "Target",
    description:
      "checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes",
    prompt: `${CREATE_AUTOMATION_PROMPT}checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes.`,
  },
  {
    label: "Stale worktrees",
    icon: "FolderGit",
    description:
      "checks daily for stale worktrees and opens cleanup threads only after they exceed the team's retention window",
    prompt: `${CREATE_AUTOMATION_PROMPT}checks daily for stale worktrees and opens cleanup threads only after they exceed the team's retention window.`,
  },
] as const;

type OverviewEntry = AutomationsOverviewResponse["automations"][number];
type AutomationProjectFilter = `project:${string}`;
type AutomationSortMode = "project" | "alpha";
type AutomationSortDirection = "asc" | "desc";
type AutomationCollectionMode = "installed" | "browse";

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

interface ParsedDetailRoute {
  route: DetailRoute;
  editing: boolean;
}

function parseSubPath(subPath: string): ParsedDetailRoute | null {
  const parts = subPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 2 || (parts.length === 3 && parts[2] === "edit")) {
    return {
      route: { projectId: parts[0], automationId: parts[1] },
      editing: parts[2] === "edit",
    };
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
  refetch: () => void;
} {
  const rpc = useRpc<typeof automationRpcContract>();
  const [state, setState] = useState<{
    entries: OverviewEntry[] | null;
    error: string | null;
  }>({ entries: null, error: null });
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestInFlightRef = useRef(false);
  const trailingRefetchRef = useRef(false);

  const runRefetch = useCallback(
    function requestOverview(showLoading: boolean) {
      if (requestInFlightRef.current) {
        trailingRefetchRef.current = true;
        return;
      }
      requestInFlightRef.current = true;
      if (showLoading) {
        setState({ entries: null, error: null });
      }
      rpc
        .call("automations_overview")
        .then(
          (result) => {
            const data = result as AutomationsOverviewResponse;
            setState({ entries: data.automations, error: null });
          },
          (error: unknown) =>
            setState((current) =>
              !showLoading && current.entries !== null
                ? current
                : { entries: null, error: errorText(error) },
            ),
        )
        .finally(() => {
          requestInFlightRef.current = false;
          if (trailingRefetchRef.current) {
            trailingRefetchRef.current = false;
            requestOverview(false);
          }
        });
    },
    [rpc],
  );
  const refetch = useCallback(() => runRefetch(true), [runRefetch]);

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
    if (requestInFlightRef.current) {
      trailingRefetchRef.current = true;
      return;
    }
    if (refetchTimerRef.current !== null) return;
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      runRefetch(false);
    }, 75);
  }, [runRefetch]);
  // Any create/update/pause/resume/run/delete or run-completion touches the
  // overview (rows show last-run status), so refetch on either kind.
  useRealtime("automations", (payload) => {
    if (asSignal(payload) !== null) scheduleRefetch();
  });
  return { ...state, refetch };
}

function useAutomation(route: DetailRoute): {
  automation: AutomationResponse | null;
  error: string | null;
  missing: boolean;
  refetch: () => void;
} {
  const rpc = useRpc<typeof automationRpcContract>();
  const { projectId, automationId } = route;
  const [state, setState] = useState<{
    automation: AutomationResponse | null;
    error: string | null;
    missing: boolean;
  }>({ automation: null, error: null, missing: false });
  const requestRef = useRef(0);

  const refetch = useCallback(() => {
    const requestId = ++requestRef.current;
    setState((current) => ({ ...current, error: null, missing: false }));
    rpc.call("automations_get", { projectId, automationId }).then(
      (result) => {
        if (requestRef.current !== requestId) return;
        const automation = result as AutomationResponse | null;
        setState({
          automation: automation ?? null,
          error: null,
          missing: automation === null,
        });
      },
      (error: unknown) => {
        if (requestRef.current !== requestId) return;
        setState({ automation: null, error: errorText(error), missing: false });
      },
    );
  }, [rpc, projectId, automationId]);

  useEffect(() => {
    setState({ automation: null, error: null, missing: false });
    refetch();
    return () => {
      requestRef.current += 1;
    };
  }, [refetch]);
  useRealtime("automations", (payload) => {
    const signal = asSignal(payload);
    if (signal !== null && signal.projectId === projectId) refetch();
  });
  return { ...state, refetch };
}

interface RunsState {
  runs: AutomationRunResponse[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

function useRuns(
  route: DetailRoute,
): RunsState & { loadMore: () => void; retry: () => void } {
  const rpc = useRpc<typeof automationRpcContract>();
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
    rpc
      .call("automations_runs", { projectId, automationId, cursor })
      .then(
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
      )
      .finally(() => {
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
  return { ...state, loadMore, retry: loadFirstPage };
}

// ---------------------------------------------------------------------------
// Mutations — pause/resume/run/delete all take { projectId, automationId }.
// ---------------------------------------------------------------------------

function useMutations() {
  const rpc = useRpc<typeof automationRpcContract>();
  type MutationMethod =
    | "automations_pause"
    | "automations_resume"
    | "automations_run"
    | "automations_delete";
  const call = useCallback(
    (method: MutationMethod, route: DetailRoute) => rpc.call(method, route),
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

// Shared bits.
// ---------------------------------------------------------------------------

function AutomationRowLeading({
  automation,
}: {
  automation: AutomationResponse;
}) {
  if (automation.lastRunStatus === "failed") {
    return (
      <Icon
        name="CircleX"
        className={cn(
          "text-destructive",
          COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
        )}
        aria-label="Failed"
      />
    );
  }
  if (automation.lastRunStatus === "running") {
    return (
      <Icon
        name="Loading"
        className={cn(
          "animate-spin text-muted-foreground/50",
          COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
        )}
        aria-label="Running"
      />
    );
  }
  return (
    <Icon
      name={automationIconName(automation)}
      className={cn(
        "text-muted-foreground",
        COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
      )}
      aria-hidden
    />
  );
}

function automationProjectLabel(
  project: OverviewEntry["project"] | null | undefined,
): string {
  if (project == null) return "Workspace";
  return project.id === PERSONAL_PROJECT_ID ? "Local" : project.name;
}

function automationProjectContextLabel(projectLabel: string): string {
  return projectLabel;
}

function automationProjectFilterId(
  entry: OverviewEntry,
): AutomationProjectFilter {
  const projectId = entry.project?.id ?? entry.automation.projectId;
  return `project:${projectId}`;
}

function applyAutomationSortDirection(
  result: number,
  direction: AutomationSortDirection,
): number {
  return direction === "asc" ? result : -result;
}

/**
 * Confirm-before-delete dialog, controlled by the caller. Uses the responsive
 * Dialog — a centered modal on desktop, a bottom drawer on compact viewports —
 * matching the kernel's ConfirmDeleteDialog pattern. Kept mounted until the
 * mutation resolves so the pending state stays visible.
 */
function DeleteAutomationDialog({
  open,
  onOpenChange,
  name,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete automation?</DialogTitle>
              <DialogDescription>
                &ldquo;{name}&rdquo; and its run history will be permanently
                removed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={onConfirm}
              >
                Delete
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// List view (panel root): the cross-project overview.
// ---------------------------------------------------------------------------

function OverviewRow({
  entry,
  onNavigate,
  onEnabledChange,
}: {
  entry: OverviewEntry;
  onNavigate: (route: DetailRoute) => void;
  onEnabledChange: (enabled: boolean, route: DetailRoute) => Promise<void>;
}) {
  const { automation } = entry;
  const [togglePending, setTogglePending] = useState(false);
  const route = routeOf(automation);
  const oneShotLifecycle = getOneShotLifecycle({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
    lastRunStatus: automation.lastRunStatus,
  });
  const lifecycleLocked = !oneShotLifecycleAllowsToggle(oneShotLifecycle);
  const triggerLabel = formatAutomationTrigger(automation.trigger);
  const scheduleMetadata = formatOverviewScheduleMetadata({
    enabled: automation.enabled,
    nextRunAt: automation.nextRunAt,
    trigger: automation.trigger,
    runCount: automation.runCount,
    lastRunStatus: automation.lastRunStatus,
  });
  const projectLabel = automationProjectLabel(entry.project);

  return (
    <ResourceRow
      leading={<AutomationRowLeading automation={automation} />}
      title={automation.name}
      description={
        <ResourceMeta
          items={[
            <ResourceLocationMeta
              label={automationProjectContextLabel(projectLabel)}
              icon={projectLabel === "Local" ? "Laptop" : "Folder"}
            />,
            <span className="inline-flex items-center gap-1.5">
              <Icon name="Clock" className="size-3.5" aria-hidden />
              {triggerLabel}
            </span>,
            scheduleMetadata ? (
              <span>
                {scheduleMetadata.emphasis ? (
                  <span className="font-medium text-foreground">
                    {scheduleMetadata.emphasis}
                  </span>
                ) : null}
                {scheduleMetadata.emphasis ? " " : null}
                {scheduleMetadata.text}
              </span>
            ) : null,
          ]}
        />
      }
      muted={lifecycleLocked}
      onOpen={() => onNavigate(route)}
      persistentActions={
        <AutomationLifecycleControl
          checked={automation.enabled && !lifecycleLocked}
          disabled={lifecycleLocked || togglePending}
          disabledReason={
            lifecycleLocked
              ? oneShotLifecycle === "expired"
                ? "This one-time automation expired. Open it and edit the schedule to run it again."
                : "This one-time automation has completed. Open it and edit the schedule to run it again."
              : undefined
          }
          label={`${automation.enabled ? "Disable" : "Enable"} ${automation.name}`}
          onCheckedChange={(enabled) => {
            setTogglePending(true);
            void onEnabledChange(enabled, route).finally(() =>
              setTogglePending(false),
            );
          }}
        />
      }
      trailingVisual={<ResourceRowDetailChevron />}
    />
  );
}

function OverviewView({
  onOpenDetail,
  activeMode,
  onModeChange,
}: {
  onOpenDetail: (route: DetailRoute, options?: { editing?: boolean }) => void;
  activeMode: AutomationCollectionMode;
  onModeChange: (mode: AutomationCollectionMode) => void;
}) {
  const navigate = useBbNavigate();
  const { entries, error, refetch } = useOverview();
  const mutations = useMutations();
  const [query, setQuery] = useState("");
  const [projectFilters, setProjectFilters] = useState<
    AutomationProjectFilter[]
  >([]);
  const [sortMode, setSortMode] = useState<AutomationSortMode>("alpha");
  const [sortDirection, setSortDirection] =
    useState<AutomationSortDirection>("asc");

  const changeEnabled = useCallback(
    async (enabled: boolean, route: DetailRoute) => {
      const method = enabled ? "resume" : "pause";
      try {
        await mutations[method](route);
      } catch (rpcError: unknown) {
        toast.error(`Failed to ${method} automation: ${errorText(rpcError)}`);
      }
    },
    [mutations],
  );

  const createViaChat = useCallback(
    (prompt?: string) => {
      navigate.toCompose({
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_AUTOMATION_PROMPT,
        experimental_replaceInitialPrompt: true,
      });
    },
    [navigate],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const projectCounts = useMemo(() => {
    const counts = new Map<AutomationProjectFilter, number>();
    for (const entry of entries ?? []) {
      const project = automationProjectFilterId(entry);
      counts.set(project, (counts.get(project) ?? 0) + 1);
    }
    return counts;
  }, [entries]);
  const projectBucketCount = projectCounts.size;
  const projectOptions = useMemo(() => {
    const options = new Map<AutomationProjectFilter, string>();
    for (const entry of entries ?? []) {
      const projectLabel = automationProjectLabel(entry.project);
      options.set(automationProjectFilterId(entry), projectLabel);
    }
    return [...options].map(([id, label]) => ({ id, label }));
  }, [entries]);
  useEffect(() => {
    setProjectFilters((current) =>
      current.filter((project) => projectCounts.has(project)),
    );
  }, [projectCounts]);
  useEffect(() => {
    if (sortMode === "project" && projectBucketCount <= 1) {
      setSortMode("alpha");
      setSortDirection("asc");
    }
  }, [projectBucketCount, sortMode]);
  const filteredEntries = useMemo(() => {
    if (entries === null) return [];
    return entries.filter((entry) => {
      const { automation, project } = entry;
      if (
        projectFilters.length > 0 &&
        !projectFilters.includes(automationProjectFilterId(entry))
      ) {
        return false;
      }
      if (normalizedQuery.length === 0) return true;
      return [
        automation.name,
        project.name,
        automationScheduleLabel(automation),
        formatAutomationTrigger(automation.trigger),
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [entries, normalizedQuery, projectFilters]);
  const visibleEntries = useMemo(() => {
    return [...filteredEntries].sort((left, right) => {
      const base =
        sortMode === "project"
          ? automationProjectLabel(left.project).localeCompare(
              automationProjectLabel(right.project),
            ) || left.automation.name.localeCompare(right.automation.name)
          : left.automation.name.localeCompare(right.automation.name);
      return applyAutomationSortDirection(base, sortDirection);
    });
  }, [filteredEntries, sortDirection, sortMode]);
  const installedPagination = useResourcePagination(visibleEntries, {
    pageSize: RESOURCE_LIST_PAGE_SIZE,
    resetKey: [
      normalizedQuery,
      projectFilters.join(","),
      sortMode,
      sortDirection,
    ].join("\u0000"),
  });
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (nextSort !== "project" && nextSort !== "alpha") return;
      if (nextSort === "project" && projectBucketCount <= 1) return;
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection("asc");
    },
    [projectBucketCount, sortMode],
  );

  let body: ReactNode;
  if (error !== null) {
    body = (
      <ResourceListState
        state="error"
        message="Couldn't load automations."
        onRetry={refetch}
      />
    );
  } else if (entries === null) {
    body = <ResourceListState state="loading" message="Loading automations" />;
  } else if (entries.length === 0) {
    body = (
      <ResourceListState state="empty" message="No automations installed." />
    );
  } else if (visibleEntries.length === 0) {
    body = (
      <ResourceListState
        state="empty"
        message={
          normalizedQuery === ""
            ? "No automations match these projects."
            : `No automations match "${query}"`
        }
      />
    );
  } else {
    body = (
      <ResourceListPanel>
        {installedPagination.items.map((entry) => (
          <OverviewRow
            key={entry.automation.id}
            entry={entry}
            onNavigate={onOpenDetail}
            onEnabledChange={changeEnabled}
          />
        ))}
      </ResourceListPanel>
    );
  }

  return (
    <ResourceCollectionPage
      id="automations-collection"
      description="Manage scheduled bb work across projects and folders. Automations run recurring or one-time tasks without manual prompting."
      modes={[
        {
          id: "installed",
          label: "Installed",
          count: entries?.length ?? undefined,
        },
        { id: "browse", label: "Browse" },
      ]}
      activeMode={activeMode}
      onModeChange={onModeChange}
      actions={
        <ResourceCreateButton
          label="New automation"
          templates={AUTOMATION_CREATE_TEMPLATES}
          onCreate={createViaChat}
        />
      }
    >
      {activeMode === "browse" ? (
        <ResourceCollectionViewport contentClassName="space-y-3">
          <ResourceBrowseGrid>
            {AUTOMATION_CREATE_TEMPLATES.map((template) => (
              <ResourceTemplateBrowseCard
                key={template.label}
                title={template.label}
                description={template.description}
                onUse={() => createViaChat(template.prompt)}
              />
            ))}
          </ResourceBrowseGrid>
        </ResourceCollectionViewport>
      ) : (
        <ResourceCollectionViewport
          scrollId="automations-installed-results"
          toolbar={
            <ResourceToolbar
              searchValue={query}
              searchPlaceholder="Search automations"
              onSearchChange={setQuery}
              controls={
                <>
                  <ResourceMultiSelectMenu
                    label="Projects"
                    icon="Layers"
                    selectedValues={projectFilters}
                    options={projectOptions}
                    onChange={(values) =>
                      setProjectFilters(values as AutomationProjectFilter[])
                    }
                  />
                  <ResourceSortMenu
                    value={sortMode}
                    direction={sortDirection}
                    options={[
                      {
                        id: "project",
                        label: "Project",
                        disabled: projectBucketCount <= 1,
                      },
                      { id: "alpha", label: "Automation name" },
                    ]}
                    onChange={handleSortChange}
                  />
                </>
              }
            />
          }
          footer={
            installedPagination.total > installedPagination.pageSize ? (
              <ResourcePagination
                page={installedPagination.page}
                pageSize={installedPagination.pageSize}
                total={installedPagination.total}
                visibleCount={installedPagination.visibleCount}
                onPageChange={installedPagination.setPage}
                scrollTargetId="automations-installed-results"
              />
            ) : undefined
          }
        >
          {body}
        </ResourceCollectionViewport>
      )}
    </ResourceCollectionPage>
  );
}

function DetailView({
  route,
  initialEditing,
  onBack,
}: {
  route: DetailRoute;
  initialEditing: boolean;
  onBack: () => void;
}) {
  const navigate = useBbNavigate();
  const { automation, error, missing, refetch } = useAutomation(route);
  const overviewState = useOverview();
  const runsState = useRuns(route);
  const mutations = useMutations();
  const [actionPending, setActionPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openThread = useCallback(
    (threadId: string) => navigate.toThread(threadId),
    [navigate],
  );

  const editViaThread = useCallback(
    (target: AutomationResponse, replace = false) => {
      navigate.toCompose({
        focusPrompt: true,
        initialPrompt: buildAutomationEditThreadPrompt({
          name: target.name,
          projectId: route.projectId,
          automationId: route.automationId,
        }),
        experimental_replaceInitialPrompt: true,
        experimental_replace: replace,
      });
    },
    [navigate, route],
  );

  useEffect(() => {
    if (!initialEditing || automation === null) return;
    editViaThread(automation, true);
  }, [automation, editViaThread, initialEditing]);

  const runAction = useCallback(
    (method: "pause" | "resume" | "run") => {
      setActionPending(true);
      mutations[method](route)
        .then(
          () => {
            if (method === "run") toast.success("Run started");
          },
          (rpcError: unknown) =>
            toast.error(
              `Failed to ${method} automation: ${errorText(rpcError)}`,
            ),
        )
        .finally(() => setActionPending(false));
    },
    [mutations, route],
  );

  const openEdit = useCallback(() => {
    if (automation === null) return;
    editViaThread(automation);
  }, [automation, editViaThread]);

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

  if (error !== null || missing) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ResourceListState
          state="error"
          message={
            missing
              ? "Automation not found."
              : `Couldn't load automation: ${error}`
          }
          onRetry={refetch}
        />
      </div>
    );
  }

  if (automation === null) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (initialEditing) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-sm text-muted-foreground">Opening composer…</p>
      </div>
    );
  }

  const overviewEntry = overviewState.entries?.find(
    (entry) =>
      entry.automation.projectId === route.projectId &&
      entry.automation.id === route.automationId,
  );
  const projectLabel =
    overviewEntry !== undefined
      ? automationProjectLabel(overviewEntry.project)
      : route.projectId === PERSONAL_PROJECT_ID
        ? "Local"
        : route.projectId;

  return (
    <AutomationDetailView
      automation={automation}
      projectLabel={projectLabel}
      runsState={runsState}
      actionPending={actionPending}
      onToggle={(checked) => runAction(checked ? "resume" : "pause")}
      onEdit={openEdit}
      onRunNow={() => runAction("run")}
      onDelete={() => setDeleteOpen(true)}
      onOpenThread={openThread}
      footer={
        <DeleteAutomationDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          name={automation.name}
          pending={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteOpen(false)}
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Panel root — routes between overview and detail by subPath.
// ---------------------------------------------------------------------------

function AutomationsPanel({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const parsedRoute = useMemo(() => parseSubPath(subPath), [subPath]);
  const collectionMode: AutomationCollectionMode =
    subPath === "browse" ? "browse" : "installed";
  const openDetail = useCallback(
    (next: DetailRoute, options?: { editing?: boolean }) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: `${next.projectId}/${next.automationId}${
          options?.editing ? "/edit" : ""
        }`,
      });
    },
    [navigate],
  );
  const backToList = useCallback(() => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
  }, [navigate]);
  const changeCollectionMode = useCallback(
    (mode: AutomationCollectionMode) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: mode === "browse" ? "browse" : "",
      });
    },
    [navigate],
  );
  if (parsedRoute !== null) {
    return (
      <DetailView
        route={parsedRoute.route}
        initialEditing={parsedRoute.editing}
        onBack={backToList}
      />
    );
  }
  return (
    <OverviewView
      onOpenDetail={openDetail}
      activeMode={collectionMode}
      onModeChange={changeCollectionMode}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "automations",
    title: "Automations",
    icon: "TimeSchedule",
    path: PANEL_PATH,
    component: AutomationsPanel,
  });
});
