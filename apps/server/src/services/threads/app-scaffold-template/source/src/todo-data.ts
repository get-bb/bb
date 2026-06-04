export const TODO_DATA_PREFIX = "todos";

const TODO_PATH_PREFIX = `${TODO_DATA_PREFIX}/`;

export interface TodoRecord {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Todo state folded from the bb app data change stream. The SDK replays
 * existing records to every new `onChange` subscriber, so this stream is the
 * single source of truth — there is no separate list/snapshot load that could
 * apply stale data over newer change events. `invalidPaths` tracks records
 * under the todos prefix that are not well-formed todos.
 */
export interface TodoDataState {
  todos: TodoRecord[];
  invalidPaths: readonly AppDataPath[];
}

export const EMPTY_TODO_DATA_STATE: TodoDataState = {
  todos: [],
  invalidPaths: [],
};

interface ApplyTodoDataChangeArgs {
  state: TodoDataState;
  event: BbDataChangeEvent;
}

interface TodoRecordFieldArgs {
  key: string;
  value: JsonObject;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(args: TodoRecordFieldArgs): string | null {
  const field = args.value[args.key];
  return typeof field === "string" && field.trim().length > 0 ? field : null;
}

function readBooleanField(args: TodoRecordFieldArgs): boolean | null {
  const field = args.value[args.key];
  return typeof field === "boolean" ? field : null;
}

function todoIdFromPath(path: AppDataPath): string | null {
  if (!path.startsWith(TODO_PATH_PREFIX)) {
    return null;
  }
  const id = path.slice(TODO_PATH_PREFIX.length);
  return id.length > 0 && !id.includes("/") ? id : null;
}

function compareTodos(left: TodoRecord, right: TodoRecord): number {
  if (left.done !== right.done) {
    return left.done ? 1 : -1;
  }
  return right.createdAt.localeCompare(left.createdAt);
}

function withoutTodo(todos: TodoRecord[], id: string | null): TodoRecord[] {
  if (id === null || !todos.some((todo) => todo.id === id)) {
    return todos;
  }
  return todos.filter((todo) => todo.id !== id);
}

function withInvalidPath(
  paths: readonly AppDataPath[],
  path: AppDataPath,
): readonly AppDataPath[] {
  return paths.includes(path) ? paths : [...paths, path];
}

function withoutInvalidPath(
  paths: readonly AppDataPath[],
  path: AppDataPath,
): readonly AppDataPath[] {
  return paths.includes(path)
    ? paths.filter((candidate) => candidate !== path)
    : paths;
}

export function todoPath(id: string): AppDataPath {
  return `${TODO_DATA_PREFIX}/${id}`;
}

export function todoFromJsonValue(
  value: JsonValue | undefined,
): TodoRecord | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const id = readStringField({ value, key: "id" });
  const title = readStringField({ value, key: "title" });
  const done = readBooleanField({ value, key: "done" });
  const createdAt = readStringField({ value, key: "createdAt" });
  const updatedAt = readStringField({ value, key: "updatedAt" });

  if (
    id === null ||
    title === null ||
    done === null ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    id,
    title,
    done,
    createdAt,
    updatedAt,
  };
}

export function todoToJsonValue(todo: TodoRecord): JsonObject {
  return {
    id: todo.id,
    title: todo.title,
    done: todo.done,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

export function applyTodoDataChange(
  args: ApplyTodoDataChangeArgs,
): TodoDataState {
  const id = todoIdFromPath(args.event.path);

  if (args.event.deleted) {
    const todos = withoutTodo(args.state.todos, id);
    const invalidPaths = withoutInvalidPath(
      args.state.invalidPaths,
      args.event.path,
    );
    return todos === args.state.todos &&
      invalidPaths === args.state.invalidPaths
      ? args.state
      : { todos, invalidPaths };
  }

  const todo = todoFromJsonValue(args.event.value);
  if (id === null || todo === null || todo.id !== id) {
    // The record at this path is not a well-formed todo: count it as invalid
    // and drop any previously-valid todo it overwrote.
    const todos = withoutTodo(args.state.todos, id);
    const invalidPaths = withInvalidPath(
      args.state.invalidPaths,
      args.event.path,
    );
    return todos === args.state.todos &&
      invalidPaths === args.state.invalidPaths
      ? args.state
      : { todos, invalidPaths };
  }

  const todos = args.state.todos.filter((candidate) => candidate.id !== id);
  todos.push(todo);
  return {
    todos: todos.sort(compareTodos),
    invalidPaths: withoutInvalidPath(args.state.invalidPaths, args.event.path),
  };
}

export function createTodoId(): string {
  const randomId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `todo_${randomId.replaceAll("-", "_")}`;
}

export function createTodoRecord(title: string): TodoRecord {
  const now = new Date().toISOString();
  return {
    id: createTodoId(),
    title,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function toggledTodoRecord(todo: TodoRecord): TodoRecord {
  return {
    ...todo,
    done: !todo.done,
    updatedAt: new Date().toISOString(),
  };
}
