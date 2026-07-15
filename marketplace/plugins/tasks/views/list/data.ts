import { useTasksQuery } from "../../shell/data.js";
import type {
  Label,
  Task,
  TaskPriority,
  TaskStatus,
  TaskThread,
} from "../../shared/contract.js";

export interface ListTaskFilters {
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  labelIds: readonly string[];
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
      (
        await rpc.call("listTasks", {
          ...(projectId === null ? {} : { projectId }),
          ...(filters.statuses.length > 0
            ? { statuses: [...filters.statuses] }
            : {}),
          ...(filters.priorities.length > 0
            ? { priorities: [...filters.priorities] }
            : {}),
          ...(filters.labelIds.length > 0
            ? { labelIds: [...filters.labelIds] }
            : {}),
          activeOnly,
          parentTaskId: null,
        })
      ).tasks,
    ["tasks:changed", "threads:changed"],
    [
      projectId,
      activeOnly,
      filters.statuses.join(),
      filters.priorities.join(),
      filters.labelIds.join(),
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
  activeThreads: TaskThread[];
  commentCount: number;
  attachmentCount: number;
}

/**
 * Row metadata (working agents, comment/attachment counts). The contract has
 * no bulk endpoint for these, so this fans out per task — fine at current
 * scale; a batched RPC is the follow-up if lists grow large.
 */
export function useTaskListMeta(tasks: readonly Task[] | undefined) {
  const taskIds = (tasks ?? []).map((task) => task.id);
  return useTasksQuery<Map<string, TaskRowMeta>>(
    async (rpc) => {
      const entries = await Promise.all(
        taskIds.map(async (taskId) => {
          const [threads, comments, attachments] = await Promise.all([
            rpc.call("listTaskThreads", { taskId }),
            rpc.call("listComments", { taskId }),
            rpc.call("listAttachments", { taskId }),
          ]);
          const meta: TaskRowMeta = {
            activeThreads: threads.taskThreads.filter(
              (thread) =>
                thread.liveStatus === "starting" ||
                thread.liveStatus === "working",
            ),
            commentCount: comments.comments.filter(
              (comment) => comment.kind !== "system",
            ).length,
            attachmentCount: attachments.attachments.length,
          };
          return [taskId, meta] as const;
        }),
      );
      return new Map(entries);
    },
    ["threads:changed", "comments:changed", "tasks:changed"],
    [taskIds.join()],
  );
}
