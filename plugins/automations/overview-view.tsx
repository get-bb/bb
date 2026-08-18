import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AutomationResponse,
  AutomationsOverviewResponse,
} from "./src/rpc-types.js";
import {
  AutomationLifecycleControl,
  automationIconName,
  automationScheduleLabel,
} from "./detail-view.js";
import { Icon } from "@bb/shared-ui/icon";
import { DelayedLoading } from "./delayed-loading.js";
import {
  ResourcePagination,
  useResourcePagination,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import { COARSE_POINTER_ICON_SIZE_SHRINK_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  ResourceBrowseGrid,
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceCreateButton,
  ResourceListPanel,
  ResourceListState,
  ResourceFilterMenu,
  ResourceMeta,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceTemplateBrowseCard,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  type AutomationStatusFilter,
  formatAutomationTrigger,
  formatOverviewScheduleMetadata,
  getOneShotLifecycle,
  matchesAutomationStatusFilters,
  oneShotLifecycleAllowsToggle,
} from "./lib/format-schedule.js";
import { AutomationMetadataItem } from "./metadata.js";

const PERSONAL_PROJECT_ID = "proj_personal";

const AUTOMATION_STATUS_FILTER_OPTIONS = [
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
] as const;

export const CREATE_AUTOMATION_PROMPT = "Create a new bb automation to ";
export const AUTOMATION_CREATE_TEMPLATES = [
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
export type AutomationCollectionMode = "installed" | "browse";

export interface AutomationDetailRoute {
  projectId: string;
  automationId: string;
}

function routeOf(automation: AutomationResponse): AutomationDetailRoute {
  return { projectId: automation.projectId, automationId: automation.id };
}

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

function automationProjectFilterId(
  entry: OverviewEntry,
): AutomationProjectFilter {
  const projectId = entry.project?.id ?? entry.automation.projectId;
  return `project:${projectId}`;
}

// The filter menu hands back plain strings, so both selections are narrowed on
// the way in rather than cast. A cast would keep type-checking while silently
// admitting a value the rest of the component cannot map back to a project or
// a status.
function isAutomationProjectFilter(
  value: string,
): value is AutomationProjectFilter {
  return value.startsWith("project:");
}

function isAutomationStatusFilter(
  value: string,
): value is AutomationStatusFilter {
  return AUTOMATION_STATUS_FILTER_OPTIONS.some(
    (option) => option.id === value,
  );
}

function applyAutomationSortDirection(
  result: number,
  direction: AutomationSortDirection,
): number {
  return direction === "asc" ? result : -result;
}

function automationLifecycleSortRank(automation: AutomationResponse): number {
  const oneShotLifecycle = getOneShotLifecycle({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
    lastRunStatus: automation.lastRunStatus,
  });
  if (oneShotLifecycle === "completed") return 3;
  if (!automation.enabled && oneShotLifecycle !== "running") return 2;
  if (oneShotLifecycle === "scheduled") return 1;
  return 0;
}

function OverviewRow({
  entry,
  onNavigate,
  onEnabledChange,
}: {
  entry: OverviewEntry;
  onNavigate: (route: AutomationDetailRoute) => void;
  onEnabledChange: (
    enabled: boolean,
    route: AutomationDetailRoute,
  ) => Promise<void>;
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
  const personalProject = entry.project.id === PERSONAL_PROJECT_ID;

  return (
    <ResourceRow
      leading={<AutomationRowLeading automation={automation} />}
      title={automation.name}
      description={
        <ResourceMeta
          items={[
            <AutomationMetadataItem
              icon={personalProject ? "Laptop" : "Folder"}
              iconLabel={personalProject ? "Local project" : "Project"}
              title={projectLabel}
            >
              {projectLabel}
            </AutomationMetadataItem>,
            <AutomationMetadataItem icon="DateTime" iconLabel="Schedule">
              {triggerLabel}
            </AutomationMetadataItem>,
            scheduleMetadata ? (
              <AutomationMetadataItem
                icon={
                  scheduleMetadata.isNextRun ? "CalendarCheckOut02" : undefined
                }
                iconLabel={scheduleMetadata.isNextRun ? "Next run" : undefined}
              >
                {scheduleMetadata.text}
              </AutomationMetadataItem>
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
                ? "Missed its run time. Edit to reschedule."
                : "Already ran. Edit to reschedule."
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

export function AutomationOverviewView({
  entries,
  error,
  onRetry,
  onOpenDetail,
  onEnabledChange,
  onCreateViaChat,
  activeMode,
  onModeChange,
}: {
  entries: OverviewEntry[] | null;
  error: string | null;
  onRetry: () => void;
  onOpenDetail: (route: AutomationDetailRoute) => void;
  onEnabledChange: (
    enabled: boolean,
    route: AutomationDetailRoute,
  ) => Promise<void>;
  onCreateViaChat: (prompt?: string) => void;
  activeMode: AutomationCollectionMode;
  onModeChange: (mode: AutomationCollectionMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [projectFilters, setProjectFilters] = useState<
    AutomationProjectFilter[]
  >([]);
  const [statusFilters, setStatusFilters] = useState<AutomationStatusFilter[]>(
    [],
  );
  const [sortMode, setSortMode] = useState<AutomationSortMode>("alpha");
  const [sortDirection, setSortDirection] =
    useState<AutomationSortDirection>("asc");

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
      options.set(
        automationProjectFilterId(entry),
        automationProjectLabel(entry.project),
      );
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
      if (!matchesAutomationStatusFilters(automation, statusFilters)) {
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
  }, [entries, normalizedQuery, projectFilters, statusFilters]);
  const visibleEntries = useMemo(() => {
    return [...filteredEntries].sort((left, right) => {
      const lifecycleOrder =
        automationLifecycleSortRank(left.automation) -
        automationLifecycleSortRank(right.automation);
      if (lifecycleOrder !== 0) return lifecycleOrder;
      const base =
        sortMode === "project"
          ? automationProjectLabel(left.project).localeCompare(
              automationProjectLabel(right.project),
            ) || left.automation.name.localeCompare(right.automation.name)
          : left.automation.name.localeCompare(right.automation.name);
      return applyAutomationSortDirection(base, sortDirection);
    });
  }, [filteredEntries, sortDirection, sortMode]);
  const [installedViewport, setInstalledViewport] =
    useState<HTMLDivElement | null>(null);
  const installedPageSize = useResourceViewportPageSize(installedViewport);
  const installedPagination = useResourcePagination(visibleEntries, {
    pageSize: installedPageSize,
    resetKey: [
      normalizedQuery,
      projectFilters.join(","),
      statusFilters.join(","),
      sortMode,
      sortDirection,
    ].join("\u0000"),
  });
  const hasInstalledPagination =
    error === null &&
    entries !== null &&
    installedPagination.total > installedPagination.pageSize;
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
        onRetry={onRetry}
      />
    );
  } else if (entries === null) {
    body = (
      <DelayedLoading>
        <ResourceListState state="loading" message="Loading automations" />
      </DelayedLoading>
    );
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
            ? "No automations match these filters."
            : projectFilters.length > 0 || statusFilters.length > 0
              ? `No automations match "${query}" with these filters.`
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
            onEnabledChange={onEnabledChange}
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
          onCreate={onCreateViaChat}
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
                onUse={() => onCreateViaChat(template.prompt)}
              />
            ))}
          </ResourceBrowseGrid>
        </ResourceCollectionViewport>
      ) : (
        <ResourceCollectionViewport
          scrollId="automations-installed-results"
          viewportRef={setInstalledViewport}
          toolbar={
            <ResourceToolbar
              searchValue={query}
              searchPlaceholder="Search automations"
              onSearchChange={setQuery}
              controls={
                <>
                  <ResourceFilterMenu
                    compact
                    groups={[
                      {
                        id: "projects",
                        label: "Projects",
                        options: projectOptions,
                        selectedValues: projectFilters,
                        onChange: (values) =>
                          setProjectFilters(
                            values.filter(isAutomationProjectFilter),
                          ),
                      },
                      {
                        id: "status",
                        label: "Status",
                        options: AUTOMATION_STATUS_FILTER_OPTIONS,
                        selectedValues: statusFilters,
                        onChange: (values) =>
                          setStatusFilters(
                            values.filter(isAutomationStatusFilter),
                          ),
                      },
                    ]}
                  />
                  <ResourceSortMenu
                    value={sortMode}
                    direction={sortDirection}
                    compact
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
            hasInstalledPagination ? (
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
