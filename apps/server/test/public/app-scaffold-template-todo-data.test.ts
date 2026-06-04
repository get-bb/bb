/// <reference path="../../src/services/threads/app-scaffold-template/source/src/bb-sdk.d.ts" />
import { describe, expect, it } from "vitest";
import {
  EMPTY_TODO_DATA_STATE,
  applyTodoDataChange,
  todoPath,
  todoToJsonValue,
  toggledTodoRecord,
  type TodoDataState,
  type TodoRecord,
} from "../../src/services/threads/app-scaffold-template/source/src/todo-data.js";

interface MakeTodoArgs {
  id: string;
  createdAt?: string;
  done?: boolean;
}

function makeTodo(args: MakeTodoArgs): TodoRecord {
  const createdAt = args.createdAt ?? "2026-06-01T10:00:00.000Z";
  return {
    id: args.id,
    title: `Todo ${args.id}`,
    done: args.done ?? false,
    createdAt,
    updatedAt: createdAt,
  };
}

function todoWriteEvent(todo: TodoRecord): BbDataChangeEvent {
  return {
    path: todoPath(todo.id),
    value: todoToJsonValue(todo),
    deleted: false,
  };
}

function deleteEvent(path: AppDataPath): BbDataChangeEvent {
  return { path, value: undefined, deleted: true };
}

function foldEvents(events: BbDataChangeEvent[]): TodoDataState {
  return events.reduce(
    (state, event) => applyTodoDataChange({ state, event }),
    EMPTY_TODO_DATA_STATE,
  );
}

describe("app scaffold template todo data", () => {
  // The template hydrates exclusively from the onChange stream (the SDK
  // replays existing records to new subscribers), so folding replayed
  // records plus later live events must yield complete state — there is no
  // separate list() snapshot that could erase a write arriving mid-load.
  it("folds replayed records and a later out-of-band write into one state", () => {
    const replayedA = makeTodo({ id: "todo_a", createdAt: "2026-06-01T08:00:00.000Z" });
    const replayedB = makeTodo({
      id: "todo_b",
      createdAt: "2026-06-01T09:00:00.000Z",
      done: true,
    });
    const liveC = makeTodo({ id: "todo_c", createdAt: "2026-06-01T10:00:00.000Z" });

    const state = foldEvents([
      todoWriteEvent(replayedA),
      todoWriteEvent(replayedB),
      todoWriteEvent(liveC),
    ]);

    expect(state.todos.map((todo) => todo.id)).toEqual([
      "todo_c",
      "todo_a",
      "todo_b",
    ]);
    expect(state.invalidPaths).toEqual([]);
  });

  it("keeps open todos before done todos, newest first within each group", () => {
    const state = foldEvents([
      todoWriteEvent(makeTodo({ id: "todo_old_open", createdAt: "2026-06-01T08:00:00.000Z" })),
      todoWriteEvent(
        makeTodo({ id: "todo_new_done", createdAt: "2026-06-01T11:00:00.000Z", done: true }),
      ),
      todoWriteEvent(makeTodo({ id: "todo_new_open", createdAt: "2026-06-01T10:00:00.000Z" })),
      todoWriteEvent(
        makeTodo({ id: "todo_old_done", createdAt: "2026-06-01T09:00:00.000Z", done: true }),
      ),
    ]);

    expect(state.todos.map((todo) => todo.id)).toEqual([
      "todo_new_open",
      "todo_old_open",
      "todo_new_done",
      "todo_old_done",
    ]);
  });

  it("removes a todo and counts its path invalid when its record is overwritten with malformed data", () => {
    const todo = makeTodo({ id: "todo_a" });
    const state = foldEvents([
      todoWriteEvent(todo),
      { path: todoPath(todo.id), value: { corrupted: true }, deleted: false },
    ]);

    expect(state.todos).toEqual([]);
    expect(state.invalidPaths).toEqual([todoPath(todo.id)]);
  });

  it("clears the invalid count when an invalid record is rewritten as a valid todo or deleted", () => {
    const todo = makeTodo({ id: "todo_a" });
    const invalidWrite: BbDataChangeEvent = {
      path: todoPath(todo.id),
      value: "not a todo",
      deleted: false,
    };

    const rewritten = foldEvents([invalidWrite, todoWriteEvent(todo)]);
    expect(rewritten.todos.map((entry) => entry.id)).toEqual([todo.id]);
    expect(rewritten.invalidPaths).toEqual([]);

    const deleted = foldEvents([invalidWrite, deleteEvent(todoPath(todo.id))]);
    expect(deleted.todos).toEqual([]);
    expect(deleted.invalidPaths).toEqual([]);
  });

  it("counts repeated invalid writes to one path once", () => {
    const state = foldEvents([
      { path: "todos/broken", value: 1, deleted: false },
      { path: "todos/broken", value: 2, deleted: false },
    ]);

    expect(state.invalidPaths).toEqual(["todos/broken"]);
  });

  it("surfaces records whose path id does not match their record id as invalid", () => {
    const todo = makeTodo({ id: "todo_a" });
    const state = foldEvents([
      { path: todoPath("todo_other"), value: todoToJsonValue(todo), deleted: false },
    ]);

    expect(state.todos).toEqual([]);
    expect(state.invalidPaths).toEqual([todoPath("todo_other")]);
  });

  it("surfaces records under nested todo paths as invalid instead of dropping them", () => {
    const todo = makeTodo({ id: "todo_a" });
    const state = foldEvents([
      { path: "todos/nested/todo_a", value: todoToJsonValue(todo), deleted: false },
    ]);

    expect(state.todos).toEqual([]);
    expect(state.invalidPaths).toEqual(["todos/nested/todo_a"]);
  });

  it("returns the same state object when an event changes nothing", () => {
    const state = foldEvents([todoWriteEvent(makeTodo({ id: "todo_a" }))]);

    expect(
      applyTodoDataChange({ state, event: deleteEvent("todos/absent") }),
    ).toBe(state);
  });

  it("toggledTodoRecord flips done and bumps updatedAt", () => {
    const todo = makeTodo({ id: "todo_a", createdAt: "2026-06-01T08:00:00.000Z" });

    const toggled = toggledTodoRecord(todo);
    expect(toggled.done).toBe(true);
    expect(Date.parse(toggled.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(todo.updatedAt),
    );

    expect(toggledTodoRecord(toggled).done).toBe(false);
    expect(toggled.createdAt).toBe(todo.createdAt);
  });
});
