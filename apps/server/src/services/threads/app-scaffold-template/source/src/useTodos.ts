import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyDataChange,
  createTodoRecord,
  todoPath,
  todoToJsonValue,
  updatedTodoRecord,
  todosFromEntries,
} from "./todo-data";
import {
  TODO_DATA_PREFIX,
  type AddTodo,
  type NotifyManager,
  type OperationStatus,
  type RemoveTodo,
  type TodoRecord,
  type TodoStats,
  type ToggleTodo,
  type UseTodosResult,
} from "./types";

interface SendManagerPayloadArgs {
  stats: TodoStats;
  todos: TodoRecord[];
}

function errorMessage(error: Error): string {
  return error.message.trim().length > 0
    ? error.message
    : "The bb SDK request failed.";
}

function sdkUnavailableMessage(): string {
  return "window.bb is not available. Open this app inside bb to read and write app data.";
}

function getBbSdk(): Bb | null {
  return window.bb ?? null;
}

function createTodoStats(todos: TodoRecord[]): TodoStats {
  const done = todos.filter((todo) => todo.done).length;
  return {
    total: todos.length,
    open: todos.length - done,
    done,
  };
}

function createManagerPayload(args: SendManagerPayloadArgs): JsonObject {
  return {
    kind: "todo-app.status",
    total: args.stats.total,
    open: args.stats.open,
    done: args.stats.done,
    todos: args.todos.map(todoToJsonValue),
  };
}

export function useTodos(): UseTodosResult {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [operationStatus, setOperationStatus] =
    useState<OperationStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const stats = useMemo(() => createTodoStats(todos), [todos]);
  const isSdkAvailable = getBbSdk() !== null;

  useEffect(() => {
    const bb = getBbSdk();
    if (bb === null) {
      setErrorText(sdkUnavailableMessage());
      return;
    }

    const data = bb.data;
    let active = true;
    const unsubscribe = data.onChange({
      prefix: TODO_DATA_PREFIX,
      callback(event) {
        if (!active) {
          return;
        }
        setTodos((current) => applyDataChange({ current, event }));
      },
    });

    async function loadTodos(): Promise<void> {
      try {
        const entries = await data.list({ prefix: TODO_DATA_PREFIX });
        if (!active) {
          return;
        }
        const snapshot = todosFromEntries(entries);
        setTodos(snapshot.todos);
        setInvalidCount(snapshot.invalidCount);
        setErrorText(null);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(
          error instanceof Error
            ? errorMessage(error)
            : "Failed to read app data.",
        );
      }
    }

    void loadTodos();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const addTodo = useCallback<AddTodo>(async (title) => {
    const bb = getBbSdk();
    if (bb === null) {
      setErrorText(sdkUnavailableMessage());
      return;
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      return;
    }

    const todo = createTodoRecord(trimmedTitle);
    setOperationStatus("saving");
    try {
      await bb.data.write({
        path: todoPath(todo.id),
        value: todoToJsonValue(todo),
      });
      setOperationStatus("idle");
      setErrorText(null);
    } catch (error) {
      setOperationStatus("error");
      setErrorText(
        error instanceof Error ? errorMessage(error) : "Failed to add todo.",
      );
    }
  }, []);

  const toggleTodo = useCallback<ToggleTodo>(
    async (id) => {
      const bb = getBbSdk();
      if (bb === null) {
        setErrorText(sdkUnavailableMessage());
        return;
      }

      const todo = todos.find((candidate) => candidate.id === id);
      if (todo === undefined) {
        return;
      }

      const nextTodo = updatedTodoRecord(todo);
      setOperationStatus("saving");
      try {
        await bb.data.write({
          path: todoPath(nextTodo.id),
          value: todoToJsonValue(nextTodo),
        });
        setOperationStatus("idle");
        setErrorText(null);
      } catch (error) {
        setOperationStatus("error");
        setErrorText(
          error instanceof Error
            ? errorMessage(error)
            : "Failed to update todo.",
        );
      }
    },
    [todos],
  );

  const removeTodo = useCallback<RemoveTodo>(async (id) => {
    const bb = getBbSdk();
    if (bb === null) {
      setErrorText(sdkUnavailableMessage());
      return;
    }

    setOperationStatus("saving");
    try {
      await bb.data.delete({ path: todoPath(id) });
      setOperationStatus("idle");
      setErrorText(null);
    } catch (error) {
      setOperationStatus("error");
      setErrorText(
        error instanceof Error ? errorMessage(error) : "Failed to remove todo.",
      );
    }
  }, []);

  const notifyManager = useCallback<NotifyManager>(async () => {
    const bb = getBbSdk();
    if (bb === null) {
      setErrorText(sdkUnavailableMessage());
      return;
    }

    setOperationStatus("sending");
    try {
      await bb.message.send({
        payload: createManagerPayload({ stats, todos }),
      });
      setOperationStatus("sent");
      setErrorText(null);
    } catch (error) {
      setOperationStatus("error");
      setErrorText(
        error instanceof Error
          ? errorMessage(error)
          : "Failed to notify the manager.",
      );
    }
  }, [stats, todos]);

  return {
    addTodo,
    errorMessage: errorText,
    invalidCount,
    isSdkAvailable,
    notifyManager,
    operationStatus,
    removeTodo,
    stats,
    todos,
    toggleTodo,
  };
}
