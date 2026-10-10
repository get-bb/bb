import type { Label, Task, TaskThread } from "../../shared/contract.js";
import { listAllTasks, type TasksRpc } from "../../shell/data.js";
import {
  signalTaskIds,
  type TaskSignal,
} from "../../shell/signal-scheduler.js";
import { isActiveThread } from "../detail/meta.js";

export interface BoardCardMeta {
  workingThreads: TaskThread[];
  attachmentCount: number;
  subDone: number;
  subTotal: number;
}

export interface BoardData {
  tasks: Task[];
  subtasks: Task[];
  labelsById: Map<string, Label>;
  metaByTaskId: Map<string, BoardCardMeta>;
}

export const EMPTY_META: BoardCardMeta = {
  workingThreads: [],
  attachmentCount: 0,
  subDone: 0,
  subTotal: 0,
};

export async function fetchBoard(
  rpc: TasksRpc,
  projectId: string,
): Promise<BoardData> {
  const tasks = await listAllTasks(rpc, { projectId });
  const topLevel = tasks.filter((task) => task.parentTaskId === null);

  const labels = await rpc.call("listLabels", { projectId }).then(
    (result) => result.labels,
    () => [],
  );
  const subProgress = new Map<string, { done: number; total: number }>();
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const entry = subProgress.get(task.parentTaskId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (task.status === "done") entry.done += 1;
    subProgress.set(task.parentTaskId, entry);
  }
  const activeTaskIds = await listAllTasks(rpc, {
    projectId,
    activeOnly: true,
  }).then(
    (result) => new Set(result.map((task) => task.id)),
    () => new Set<string>(),
  );
  const workingByTaskId = new Map<string, TaskThread[]>();
  await Promise.all(
    topLevel
      .filter((task) => activeTaskIds.has(task.id))
      .map(async (task) => {
        const threads = await rpc
          .call("listTaskThreads", { taskId: task.id })
          .then(
            (result) => result.taskThreads,
            () => [],
          );
        workingByTaskId.set(task.id, threads.filter(isActiveThread));
      }),
  );
  const attachmentCounts = new Map<string, number>();
  await Promise.all(
    topLevel.map(async (task) => {
      const count = await rpc.call("listAttachments", { taskId: task.id }).then(
        (result) => result.attachments.length,
        () => 0,
      );
      attachmentCounts.set(task.id, count);
    }),
  );

  return {
    tasks: topLevel,
    subtasks: tasks.filter((task) => task.parentTaskId !== null),
    labelsById: new Map(labels.map((label) => [label.id, label])),
    metaByTaskId: new Map(
      topLevel.map((task) => [
        task.id,
        {
          workingThreads: workingByTaskId.get(task.id) ?? [],
          attachmentCount: attachmentCounts.get(task.id) ?? 0,
          subDone: subProgress.get(task.id)?.done ?? 0,
          subTotal: subProgress.get(task.id)?.total ?? 0,
        },
      ]),
    ),
  };
}

async function workingThreadsFor(
  rpc: TasksRpc,
  taskId: string,
): Promise<TaskThread[]> {
  return rpc.call("listTaskThreads", { taskId }).then(
    (result) => result.taskThreads.filter(isActiveThread),
    () => [],
  );
}

export async function patchBoard(
  rpc: TasksRpc,
  projectId: string,
  current: BoardData,
  signals: readonly TaskSignal[],
): Promise<BoardData | null> {
  if (signals.some((signal) => signal.channel === "projects:changed")) {
    return null;
  }
  const changedIds = signalTaskIds(signals, "tasks:changed");
  const fetched = await Promise.all(
    changedIds.map(async (taskId) => {
      const { task } = await rpc.call("getTask", { taskId });
      return [taskId, task] as const;
    }),
  );
  const changed = new Map(fetched);
  const keep = (task: Task) => !changed.has(task.id);
  const tasks = current.tasks.filter(keep);
  const subtasks = current.subtasks.filter(keep);
  const metaByTaskId = new Map(current.metaByTaskId);
  for (const taskId of changed.keys()) metaByTaskId.delete(taskId);
  const refreshedCards: Task[] = [];
  for (const task of changed.values()) {
    if (task === null || task.projectId !== projectId) continue;
    if (task.parentTaskId === null) {
      tasks.push(task);
      refreshedCards.push(task);
    } else {
      subtasks.push(task);
    }
  }
  const topLevelIds = new Set(tasks.map((task) => task.id));
  const threadIds = signalTaskIds(signals, "threads:changed").filter(
    (taskId) => topLevelIds.has(taskId) && !changed.has(taskId),
  );
  await Promise.all([
    ...refreshedCards.map(async (task) => {
      const [workingThreads, attachmentCount] = await Promise.all([
        workingThreadsFor(rpc, task.id),
        rpc.call("listAttachments", { taskId: task.id }).then(
          (result) => result.attachments.length,
          () => 0,
        ),
      ]);
      metaByTaskId.set(task.id, {
        ...EMPTY_META,
        workingThreads,
        attachmentCount,
      });
    }),
    ...threadIds.map(async (taskId) => {
      const workingThreads = await workingThreadsFor(rpc, taskId);
      metaByTaskId.set(taskId, {
        ...(metaByTaskId.get(taskId) ?? EMPTY_META),
        workingThreads,
      });
    }),
  ]);
  const progress = new Map<string, { done: number; total: number }>();
  for (const task of subtasks) {
    if (task.parentTaskId === null) continue;
    const entry = progress.get(task.parentTaskId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (task.status === "done") entry.done += 1;
    progress.set(task.parentTaskId, entry);
  }
  for (const task of tasks) {
    const meta = metaByTaskId.get(task.id) ?? EMPTY_META;
    const entry = progress.get(task.id);
    metaByTaskId.set(task.id, {
      ...meta,
      subDone: entry?.done ?? 0,
      subTotal: entry?.total ?? 0,
    });
  }
  tasks.sort(
    (a, b) =>
      a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { ...current, tasks, subtasks, metaByTaskId };
}
