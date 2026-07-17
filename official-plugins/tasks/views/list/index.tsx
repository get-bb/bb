import { useEffect, useMemo, useState } from "react";
import type { Label, Task } from "../../shared/contract.js";
import { useProjects } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { NewTaskDialog } from "../manage/index.js";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useLabels, useListTasks, useTaskListMeta, type TaskRowMeta } from "./data.js";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  ListFilterBar,
  type ListFilterState,
} from "./filter-bar.js";
import {
  listPreferenceScope,
  loadListPreference,
  storeListPreference,
  type ListPreference,
} from "./list-preference.js";
import { sortTasks, type TaskSort } from "../../shared/sort.js";
import { PriorityIcon, StatusIcon } from "./icons.js";
import {
  formatDueDate,
  groupTasksByStatus,
  labelFilterOptions,
  presetShortName,
  selectedLabelIds,
  STATUS_LABELS,
} from "./lib.js";

export interface ListViewProps {
  /** null renders the cross-project "All tasks" list. */
  projectId: string | null;
  /** Only tasks with agents currently working (the Active route). */
  activeOnly?: boolean;
}

function WorkingAgentsChip({ meta }: { meta: TaskRowMeta }) {
  const threads = meta.activeThreads;
  if (threads.length === 0) return null;
  const text =
    threads.length === 1 && threads[0] !== undefined
      ? presetShortName(threads[0].presetName)
      : `${threads.length} agents`;
  return (
    <span className="flex items-center gap-1.5 font-medium text-success">
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
      />
      {text}
    </span>
  );
}

function LabelChips({
  task,
  labelsById,
}: {
  task: Task;
  labelsById: Map<string, Label>;
}) {
  const labels = task.labelIds.flatMap((id) => labelsById.get(id) ?? []);
  return (
    <>
      {labels.map((label) => (
        <span
          key={label.id}
          className="flex items-center gap-1 rounded-md border border-border px-1.5 py-px text-xs text-muted-foreground"
        >
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ backgroundColor: label.color }}
          />
          {label.name}
        </span>
      ))}
    </>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon name={icon} className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="px-3.5 pt-3">
      <Skeleton className="mb-3 h-4 w-28" />
      {Array.from({ length: 7 }, (_, index) => (
        <div
          key={index}
          className="flex h-[34px] items-center gap-2 border-b border-border-hairline"
        >
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function ListView({ projectId, activeOnly = false }: ListViewProps) {
  const navigation = useTasksNavigation();
  const projects = useProjects();
  const preferenceScope = listPreferenceScope(projectId, activeOnly);
  const [preference, setPreference] = useState<ListPreference>(() =>
    loadListPreference(preferenceScope),
  );
  // Remounts already re-read storage; this covers prop-scope changes if the
  // same ListView instance is reused across routes.
  useEffect(() => {
    setPreference(loadListPreference(preferenceScope));
  }, [preferenceScope]);
  const filters = preference.filters;
  const sort = preference.sort;
  const setFilters = (next: ListFilterState) => {
    setPreference((current) => {
      const updated: ListPreference = { filters: next, sort: current.sort };
      storeListPreference(preferenceScope, updated);
      return updated;
    });
  };
  const setSort = (next: TaskSort) => {
    setPreference((current) => {
      const updated: ListPreference = { filters: current.filters, sort: next };
      storeListPreference(preferenceScope, updated);
      return updated;
    });
  };
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const labelProjectIds = useMemo(
    () =>
      projectId !== null
        ? [projectId]
        : (projects.data ?? []).map((project) => project.id),
    [projectId, projects.data],
  );
  const labels = useLabels(labelProjectIds);
  const labelOptions = useMemo(
    () => labelFilterOptions(labels.data ?? []),
    [labels.data],
  );
  // null = no label filter. Once the catalog is loaded, unresolved selected
  // names become an active empty id list so the query matches nothing (not
  // every task). While labels are still loading, defer the filter to avoid a
  // flash of empty results before options arrive.
  const labelIds = useMemo((): readonly string[] | null => {
    if (filters.labelNames.length === 0) return null;
    if (labels.data === undefined) return null;
    return selectedLabelIds(labelOptions, filters.labelNames);
  }, [filters.labelNames, labelOptions, labels.data]);

  const tasksQuery = useListTasks(projectId, activeOnly, {
    statuses: filters.statuses,
    priorities: filters.priorities,
    labelIds,
  });
  const meta = useTaskListMeta(tasksQuery.data);

  const labelsById = useMemo(
    () => new Map((labels.data ?? []).map((label) => [label.id, label])),
    [labels.data],
  );
  const projectsById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );
  const groups = useMemo(
    () => groupTasksByStatus(sortTasks(tasksQuery.data ?? [], sort)),
    [tasksQuery.data, sort],
  );

  const showProject = projectId === null;
  const filtered = hasActiveFilters(filters);

  let body: React.ReactNode;
  if (tasksQuery.data === undefined) {
    body = tasksQuery.error !== null ? (
      <EmptyState icon="AlertCircle" title="Couldn't load tasks" description={tasksQuery.error} />
    ) : (
      <LoadingRows />
    );
  } else if (tasksQuery.data.length === 0) {
    if (filtered) {
      body = (
        <EmptyState
          icon="Search"
          title="No tasks match these filters"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear filters
            </Button>
          }
        />
      );
    } else if (activeOnly) {
      body = (
        <EmptyState
          icon="Zap"
          title="No agents working right now"
          description="Dispatch a task to an agent preset and it will show up here while it runs."
        />
      );
    } else {
      body = (
        <EmptyState
          icon="ListTodo"
          title="No tasks yet"
          description="Create the first task to start tracking work."
          action={
            <Button size="sm" onClick={() => setNewTaskOpen(true)}>
              <Icon name="Plus" className="size-3.5" />
              New task
            </Button>
          }
        />
      );
    }
  } else {
    body = groups.map((group) => (
      <section key={group.status}>
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-background px-3.5 pb-1.5 pt-2.5 text-sm font-semibold">
          <StatusIcon status={group.status} />
          {STATUS_LABELS[group.status]}
          <span className="text-xs font-normal tabular-nums text-subtle-foreground">
            {group.tasks.length}
          </span>
        </div>
        {group.tasks.map((task) => {
          const taskMeta = meta.data?.get(task.id);
          const project = projectsById.get(task.projectId);
          return (
            <button
              key={task.id}
              type="button"
              onClick={() =>
                navigation.go({ kind: "task", taskKey: task.key })
              }
              className="flex h-[34px] w-full items-center gap-2 border-b border-border-hairline px-3.5 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <PriorityIcon priority={task.priority} />
              <span className="w-14 shrink-0 truncate text-xs tabular-nums text-subtle-foreground">
                {task.key}
              </span>
              <StatusIcon status={task.status} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {task.title}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-subtle-foreground">
                {taskMeta ? <WorkingAgentsChip meta={taskMeta} /> : null}
                <LabelChips task={task} labelsById={labelsById} />
                {taskMeta !== undefined && taskMeta.attachmentCount > 0 ? (
                  <span className="flex items-center gap-0.5" title="Attachments">
                    <Icon name="Paperclip" className="size-3" />
                    {taskMeta.attachmentCount}
                  </span>
                ) : null}
                {taskMeta !== undefined && taskMeta.commentCount > 0 ? (
                  <span className="flex items-center gap-0.5" title="Comments">
                    <Icon name="MessageSquare" className="size-3" />
                    {taskMeta.commentCount}
                  </span>
                ) : null}
                {task.dueDate !== null ? (
                  <span>{formatDueDate(task.dueDate)}</span>
                ) : null}
                {showProject && project !== undefined ? (
                  <span
                    aria-hidden
                    title={project.name}
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: project.color }}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </section>
    ));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListFilterBar
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        labelOptions={labelOptions}
        taskCount={tasksQuery.data?.length}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={projectId}
      />
    </div>
  );
}
