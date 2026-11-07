import { useMemo } from "react";
import type {
  Label,
  Task,
  TaskCardMeta,
  TaskThread,
} from "../../shared/contract.js";
import {
  selectCards,
  selectLabels,
  selectTasks,
  useTasksQuery,
} from "../../shell/data.js";

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

export function boardData(
  tasks: readonly Task[],
  labels: readonly Label[],
  cards: readonly TaskCardMeta[],
): BoardData {
  const topLevel = tasks.filter((task) => task.parentTaskId === null);
  const subProgress = new Map<string, { done: number; total: number }>();
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const entry = subProgress.get(task.parentTaskId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (task.status === "done") entry.done += 1;
    subProgress.set(task.parentTaskId, entry);
  }
  const cardsByTaskId = new Map(cards.map((card) => [card.taskId, card]));
  return {
    tasks: topLevel,
    subtasks: tasks.filter((task) => task.parentTaskId !== null),
    labelsById: new Map(labels.map((label) => [label.id, label])),
    metaByTaskId: new Map(
      topLevel.map((task) => [
        task.id,
        {
          workingThreads: cardsByTaskId.get(task.id)?.activeThreads ?? [],
          attachmentCount: cardsByTaskId.get(task.id)?.attachmentCount ?? 0,
          subDone: subProgress.get(task.id)?.done ?? 0,
          subTotal: subProgress.get(task.id)?.total ?? 0,
        },
      ]),
    ),
  };
}

export function useBoard(projectId: string) {
  const tasks = useTasksQuery("listAllTasks", { projectId }, selectTasks);
  const labels = useTasksQuery("listLabels", { projectId }, selectLabels);
  const cards = useTasksQuery("listTaskCardMeta", { projectId }, selectCards);
  const labelsSettled = labels.data !== undefined || labels.error !== null;
  const cardsSettled = cards.data !== undefined || cards.error !== null;
  const data = useMemo(
    () =>
      tasks.data !== undefined && labelsSettled && cardsSettled
        ? boardData(tasks.data, labels.data ?? [], cards.data ?? [])
        : undefined,
    [tasks.data, labels.data, cards.data, labelsSettled, cardsSettled],
  );
  return {
    data,
    error: tasks.error,
    refresh: () => {
      tasks.refresh();
      labels.refresh();
      cards.refresh();
    },
  };
}
