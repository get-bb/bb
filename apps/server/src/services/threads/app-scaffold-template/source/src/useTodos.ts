import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_TODO_DATA_STATE,
  TODO_DATA_PREFIX,
  applyTodoDataChange,
  createTodoRecord,
  todoPath,
  todoToJsonValue,
  toggledTodoRecord,
  type TodoDataState,
  type TodoRecord,
} from "./todo-data";
import type {
  AddTodo,
  OperationStatus,
  RemoveTodo,
  SendStatusUpdate,
  TodoStats,
  ToggleTodo,
  UseTodosResult,
} from "./types";

interface CreateStatusPayloadArgs {
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

function createStatusPayload(args: CreateStatusPayloadArgs): JsonObject {
  return {
    kind: "todo-app.status",
    total: args.stats.total,
    open: args.stats.open,
    done: args.stats.done,
    todos: args.todos.map(todoToJsonValue),
  };
}

export function useTodos(): UseTodosResult {
  const [dataState, setDataState] = useState<TodoDataState>(
    EMPTY_TODO_DATA_STATE,
  );
  const [operationStatus, setOperationStatus] =
    useState<OperationStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const todos = dataState.todos;
  const stats = useMemo(() => createTodoStats(todos), [todos]);
  const isSdkAvailable = getBbSdk() !== null;

  useEffect(() => {
    const bb = getBbSdk();
    if (bb === null) {
      setErrorText(sdkUnavailableMessage());
      return;
    }

    let active = true;
    // The SDK replays existing records to every new onChange subscriber, so
    // this subscription alone hydrates initial state. Do not add a separate
    // list() snapshot load: its response can arrive after newer change
    // events and would clobber them.
    const unsubscribeChanges = bb.data.onChange({
      prefix: TODO_DATA_PREFIX,
      callback(event) {
        if (!active) {
          return;
        }
        setDataState((current) =>
          applyTodoDataChange({ state: current, event }),
        );
      },
    });
    // When broadcasts may have been missed (e.g. after a reconnect) the SDK
    // emits a resync and then replays every record to the onChange callback.
    // Reset first so records deleted while disconnected drop out.
    const unsubscribeResync = bb.on({
      event: "app-data:resync",
      callback() {
        if (!active) {
          return;
        }
        setDataState(EMPTY_TODO_DATA_STATE);
      },
    });

    return () => {
      active = false;
      unsubscribeChanges();
      unsubscribeResync();
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

      const nextTodo = toggledTodoRecord(todo);
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

  const sendStatusUpdate = useCallback<SendStatusUpdate>(async () => {
    const bb = getBbSdk();
    if (bb === null) {
      setErrorText(sdkUnavailableMessage());
      return;
    }

    setOperationStatus("sending");
    try {
      await bb.message.send({
        payload: createStatusPayload({ stats, todos }),
      });
      setOperationStatus("sent");
      setErrorText(null);
    } catch (error) {
      setOperationStatus("error");
      setErrorText(
        error instanceof Error
          ? errorMessage(error)
          : "Failed to send status update.",
      );
    }
  }, [stats, todos]);

  return {
    addTodo,
    errorMessage: errorText,
    invalidCount: dataState.invalidPaths.length,
    isSdkAvailable,
    operationStatus,
    removeTodo,
    sendStatusUpdate,
    stats,
    todos,
    toggleTodo,
  };
}
