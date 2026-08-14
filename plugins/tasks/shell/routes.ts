import { useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

/** The nav panel `path` registered in app.tsx; panel URLs are /plugins/tasks/<PANEL_PATH>/<subPath>. */
export const PANEL_PATH = "tasks";

export type TaskViewMode = "list" | "board";

export type TasksRoute =
  | { kind: "all" }
  | { kind: "active" }
  | { kind: "manage" }
  | { kind: "project"; projectId: string; view: TaskViewMode }
  | { kind: "task"; taskKey: string };

/**
 * subPath grammar (the trailing route below /plugins/tasks/tasks):
 *   ""                      → all tasks (default)
 *   "all"                   → all tasks
 *   "active"                → tasks with agents working
 *   "manage"                → manage panel (labels, presets, folders)
 *   "task/<taskKey>"        → task detail (e.g. task/TSK-4)
 *   "<projectId>"           → project list view
 *   "<projectId>?view=board" → project board view
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseTasksRoute(rawSubPath: string): TasksRoute {
  // The host hands the splat through URL-encoded; the `?view=` marker inside
  // a segment arrives as %3F.
  const subPath = rawSubPath.split("/").map(decodeSegment).join("/");
  const queryIndex = subPath.indexOf("?");
  const path = queryIndex === -1 ? subPath : subPath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : subPath.slice(queryIndex + 1);
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const head = segments[0];
  if (head === undefined || head === "all") return { kind: "all" };
  if (head === "active") return { kind: "active" };
  if (head === "manage") return { kind: "manage" };
  if (head === "task") {
    const taskKey = segments[1];
    if (taskKey !== undefined) return { kind: "task", taskKey };
    return { kind: "all" };
  }
  const view = new URLSearchParams(query).get("view");
  return {
    kind: "project",
    projectId: head,
    view: view === "board" ? "board" : "list",
  };
}

export function tasksRouteToSubPath(route: TasksRoute): string {
  switch (route.kind) {
    case "all":
      return "all";
    case "active":
      return "active";
    case "manage":
      return "manage";
    case "task":
      return `task/${route.taskKey}`;
    case "project":
      return route.view === "board"
        ? `${route.projectId}?view=board`
        : route.projectId;
  }
}

export interface TasksNavigation {
  go: (route: TasksRoute, options?: { replace?: boolean }) => void;
}

export function useTasksNavigation(): TasksNavigation {
  const navigate = useBbNavigate();
  return useMemo(
    () => ({
      go: (route, options) => {
        navigate.toPluginPanel(PANEL_PATH, {
          subPath: tasksRouteToSubPath(route),
          ...(options?.replace ? { replace: true } : {}),
        });
      },
    }),
    [navigate],
  );
}
