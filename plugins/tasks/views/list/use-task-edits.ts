import { useCallback, useMemo, useRef, useState } from "react";
import type { Task } from "../../shared/contract.js";
import { useTasksRpc } from "../../shell/data.js";
import {
  beginEdit,
  pendingIds,
  reconcileEntries,
  settleFailure,
  settleSuccess,
  type TaskEdit,
  type TaskEntries,
} from "./optimistic.js";

interface ListTaskEditController {
  entries: TaskEntries;
  pending: ReadonlySet<string>;
  edit: (task: Task, patch: TaskEdit) => void;
}

type TaskEditRejection = Error | string;

export function useListTaskEdits(
  serverTasks: readonly Task[] | undefined,
  onError: (message: string) => void,
): ListTaskEditController {
  const rpc = useTasksRpc();
  const [entries, setEntries] = useState<TaskEntries>(() => new Map());
  const genRef = useRef(0);
  const visibleEntries = useMemo(
    () =>
      serverTasks === undefined
        ? entries
        : reconcileEntries(entries, serverTasks),
    [entries, serverTasks],
  );

  const edit = useCallback(
    (task: Task, patch: TaskEdit) => {
      const gen = (genRef.current += 1);
      setEntries((prev) => {
        const current =
          serverTasks === undefined
            ? prev
            : reconcileEntries(prev, serverTasks);
        return beginEdit(current, task.id, patch, gen);
      });

      void rpc.call("updateTask", { taskId: task.id, ...patch }).then(
        (result) => {
          if (result.ok) {
            setEntries((prev) =>
              settleSuccess(prev, task.id, patch, gen, result.task),
            );
          } else {
            setEntries((prev) => settleFailure(prev, task.id, patch, gen));
            onError(result.error.message);
          }
        },
        (error: TaskEditRejection) => {
          setEntries((prev) => settleFailure(prev, task.id, patch, gen));
          onError(error instanceof Error ? error.message : String(error));
        },
      );
    },
    [onError, rpc, serverTasks],
  );

  const pending = useMemo(() => pendingIds(visibleEntries), [visibleEntries]);

  return { entries: visibleEntries, pending, edit };
}
