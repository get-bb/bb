import { useMemo } from "react";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { useTaskRead, useTaskRows } from "../../shell/data.js";
import type {
  Attachment,
  Label,
  TaskSummary,
  TaskThread,
} from "../../shared/contract.js";
import { isActiveThread } from "../detail/meta.js";

export interface BoardCardMeta {
  workingThreads: TaskThread[];
  attachmentCount: number;
  subDone: number;
  subTotal: number;
}
export interface BoardData {
  tasks: TaskSummary[];
  subtasks: TaskSummary[];
  labelsById: Map<string, Label>;
  metaByTaskId: Map<string, BoardCardMeta>;
}
export const EMPTY_META: BoardCardMeta = {
  workingThreads: [],
  attachmentCount: 0,
  subDone: 0,
  subTotal: 0,
};

export function useBoardData(projectId: string) {
  const rows = useTaskRows({ projectId });
  const labels = useTaskRead(
    "listLabels",
    { projectId },
    (result) => result.labels,
  );
  const keys =
    rows.data
      ?.filter((task) => task.parentTaskId === null)
      .map((task) => task.id) ?? [];
  const threads = experimental_useRpcKeyedQuery<TaskThread[]>({
    method: "getTaskThreadsKeyed",
    keys,
  });
  const attachments = experimental_useRpcKeyedQuery<Attachment[]>({
    method: "getTaskAttachmentsKeyed",
    keys,
  });
  const labelsById = useMemo(
    () => new Map(labels.data?.map((label) => [label.id, label]) ?? []),
    [labels.data],
  );
  const data = useMemo<BoardData | undefined>(() => {
    if (!rows.data) return undefined;
    const tasks = rows.data.filter((task) => task.parentTaskId === null);
    const subtasks = rows.data.filter((task) => task.parentTaskId !== null);
    const progress = new Map<string, { done: number; total: number }>();
    for (const task of subtasks) {
      const parent = task.parentTaskId!;
      const count = progress.get(parent) ?? { done: 0, total: 0 };
      count.total++;
      if (task.status === "done") count.done++;
      progress.set(parent, count);
    }
    return {
      tasks,
      subtasks,
      labelsById,
      metaByTaskId: new Map(
        tasks.map((task) => [
          task.id,
          {
            workingThreads:
              threads.data?.[task.id]?.filter(isActiveThread) ?? [],
            attachmentCount: attachments.data?.[task.id]?.length ?? 0,
            subDone: progress.get(task.id)?.done ?? 0,
            subTotal: progress.get(task.id)?.total ?? 0,
          },
        ]),
      ),
    };
  }, [rows.data, labelsById, threads.data, attachments.data]);
  return {
    data,
    isLoading: rows.isLoading,
    error:
      rows.error ??
      labels.error ??
      threads.error?.message ??
      attachments.error?.message ??
      null,
    refresh: () => {
      rows.refresh();
      labels.refresh();
      void threads.refetch();
      void attachments.refetch();
    },
  };
}
