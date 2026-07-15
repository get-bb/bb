import { useMemo } from "react";
import type { Project } from "../shared/contract.js";
import type { TaskViewMode, TasksRoute } from "./routes.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function ViewToggle({
  view,
  onChange,
}: {
  view: TaskViewMode;
  onChange: (view: TaskViewMode) => void;
}) {
  const segment = (mode: TaskViewMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={view === mode}
      className={cn(
        "rounded-sm px-2.5 py-0.5 text-xs",
        view === mode
          ? "bg-background text-foreground shadow-2xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center rounded-md bg-muted p-0.5">
      {segment("list", "List")}
      {segment("board", "Board")}
    </div>
  );
}

export interface TasksTopbarProps {
  route: TasksRoute;
  projects: Project[] | undefined;
  sidebarCollapsed: boolean;
  onNavigate: (route: TasksRoute) => void;
  onToggleSidebar: () => void;
  onNewTask: () => void;
  onBack: () => void;
}

export function TasksTopbar({
  route,
  projects,
  sidebarCollapsed,
  onNavigate,
  onToggleSidebar,
  onNewTask,
  onBack,
}: TasksTopbarProps) {
  const project = useMemo(() => {
    if (route.kind === "project") {
      return (projects ?? []).find((p) => p.id === route.projectId) ?? null;
    }
    if (route.kind === "task") {
      // Task keys are `<prefix>-<number>`, so the prefix resolves the project.
      const prefix = route.taskKey.split("-", 1)[0] ?? "";
      return (projects ?? []).find((p) => p.prefix === prefix) ?? null;
    }
    return null;
  }, [route, projects]);

  const breadcrumb = (() => {
    switch (route.kind) {
      case "all":
        return <span className="font-semibold">All tasks</span>;
      case "active":
        return (
          <span className="flex items-center gap-2">
            <span className="font-semibold">Active</span>
            <span className="text-xs font-normal text-muted-foreground">
              agents working now
            </span>
          </span>
        );
      case "project":
        return (
          <span className="flex min-w-0 items-center gap-2">
            {project ? (
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: project.color }}
              />
            ) : null}
            <span className="truncate font-semibold">
              {project?.name ?? "Project"}
            </span>
          </span>
        );
      case "task":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label="Back (Esc)"
              onClick={onBack}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            {project ? (
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onNavigate({
                    kind: "project",
                    projectId: project.id,
                    view: "list",
                  })
                }
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate font-medium">{project.name}</span>
              </button>
            ) : null}
            {project ? (
              <Icon
                name="ChevronRight"
                className="size-3 shrink-0 text-muted-foreground"
              />
            ) : null}
            <span className="shrink-0 font-medium text-muted-foreground">
              {route.taskKey}
            </span>
          </span>
        );
    }
  })();

  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border-hairline bg-background px-3.5 text-sm">
      <div className="min-w-0 flex-1">{breadcrumb}</div>
      {route.kind === "project" ? (
        <ViewToggle
          view={route.view}
          onChange={(view) => onNavigate({ ...route, view })}
        />
      ) : null}
      {route.kind !== "task" ? (
        <Button size="sm" className="h-7 gap-1.5" onClick={onNewTask}>
          <Icon name="Plus" className="size-3.5" />
          New task
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        <Icon name="PanelRight" className="size-4" />
      </Button>
    </header>
  );
}
