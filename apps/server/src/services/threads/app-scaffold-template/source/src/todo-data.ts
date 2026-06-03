import { TODO_DATA_PREFIX, type TodoRecord, type TodoSnapshot } from "./types";

interface ApplyDataChangeArgs {
  current: TodoRecord[];
  event: BbDataChangeEvent;
}

interface TodoRecordFieldArgs {
  key: string;
  value: JsonObject;
}

const TODO_PATH_PREFIX = `${TODO_DATA_PREFIX}/`;

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

export function todosFromEntries(entries: BbDataEntry[]): TodoSnapshot {
  const todos: TodoRecord[] = [];
  let invalidCount = 0;

  for (const entry of entries) {
    const pathId = todoIdFromPath(entry.path);
    const todo = todoFromJsonValue(entry.value);
    if (pathId === null || todo === null || todo.id !== pathId) {
      invalidCount += 1;
      continue;
    }
    todos.push(todo);
  }

  return {
    todos: todos.sort(compareTodos),
    invalidCount,
  };
}

export function applyDataChange(args: ApplyDataChangeArgs): TodoRecord[] {
  const id = todoIdFromPath(args.event.path);
  if (id === null) {
    return args.current;
  }

  if (args.event.deleted) {
    return args.current.filter((todo) => todo.id !== id);
  }

  const todo = todoFromJsonValue(args.event.value);
  if (todo === null || todo.id !== id) {
    return args.current;
  }

  const next = args.current.filter((candidate) => candidate.id !== id);
  next.push(todo);
  return next.sort(compareTodos);
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

export function updatedTodoRecord(todo: TodoRecord): TodoRecord {
  return {
    ...todo,
    done: !todo.done,
    updatedAt: new Date().toISOString(),
  };
}
