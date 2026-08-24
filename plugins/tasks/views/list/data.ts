import { listAllTasks, useTasksQuery } from "../../shell/data.js";
import type {
  Label,
  Task,
  TaskPriority,
  TaskStatus,
  TaskThread,
} from "../../shared/contract.js";

interface ListTaskFilters {
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  /**
   * `null` means no label filter. An array (including empty) is an active
   * label filter: empty matches nothing once the catalog is known, which is
   * how stale/deleted label names recover without silently showing all tasks.
   */
  labelIds: readonly string[] | null;
}

/**
 * Server-side filtered task list. Subtasks are excluded (parentTaskId: null),
 * matching the design mock — they surface on their parent's detail page.
 */
export function useListTasks(
  projectId: string | null,
  activeOnly: boolean,
  filters: ListTaskFilters,
) {
  return useTasksQuery(
    async (rpc) =>
      listAllTasks(rpc, {
        ...(projectId === null ? {} : { projectId }),
        ...(filters.statuses.length > 0
          ? { statuses: [...filters.statuses] }
          : {}),
        ...(filters.priorities.length > 0
          ? { priorities: [...filters.priorities] }
          : {}),
        ...(filters.labelIds !== null
          ? { labelIds: [...filters.labelIds] }
          : {}),
        activeOnly,
        parentTaskId: null,
      }),
    ["tasks:changed", "threads:changed"],
    [
      projectId,
      activeOnly,
      filters.statuses.join(),
      filters.priorities.join(),
      filters.labelIds === null ? "" : `active:${filters.labelIds.join()}`,
    ],
  );
}

/**
 * Labels for one or many projects. The contract only exposes per-project
 * listLabels, so cross-project routes fan out one call per project. (No shell
 * hook exists for labels; implemented locally per worker ownership rules.)
 */
export function useLabels(projectIds: readonly string[]) {
  return useTasksQuery<Label[]>(
    async (rpc) => {
      const results = await Promise.all(
        projectIds.map((projectId) => rpc.call("listLabels", { projectId })),
      );
      return results.flatMap((result) => result.labels);
    },
    ["projects:changed"],
    [projectIds.join()],
  );
}

export interface TaskRowMeta {
  /** Threads currently starting or working. Historical attachments (idle,
   * completed, failed) are excluded — list rows only surface live activity. */
  activeThreads: TaskThread[];
}

/**
 * Live-activity metadata for list rows. Comments and attachments are detail-
 * view concerns and are deliberately not fetched here. The contract has no
 * bulk endpoint, so this fans out per task — fine at current scale; a batched
 * RPC is the follow-up if lists grow large.
 */
export function useTaskListMeta(tasks: readonly Task[] | undefined) {
  const taskIds = (tasks ?? []).map((task) => task.id);
  return useTasksQuery<Map<string, TaskRowMeta>>(
    async (rpc) => {
      const entries = await Promise.all(
        taskIds.map(async (taskId) => {
          const threads = await rpc.call("listTaskThreads", { taskId });
          const meta: TaskRowMeta = {
            activeThreads: threads.taskThreads.filter(
              (thread) =>
                thread.liveStatus === "starting" ||
                thread.liveStatus === "working",
            ),
          };
          return [taskId, meta] as const;
        }),
      );
      return new Map(entries);
    },
    ["threads:changed", "tasks:changed"],
    [taskIds.join()],
  );
}
