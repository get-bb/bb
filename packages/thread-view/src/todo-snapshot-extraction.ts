import { z } from "zod";
import type {
  Thread,
  ThreadEvent,
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import {
  claudeTaskCreateArgsSchema,
  claudeTaskCreateOutputSchema,
  claudeTaskGetArgsSchema,
  claudeTaskGetOutputSchema,
  claudeTaskListItemSchema,
  claudeTaskListOutputSchema,
  claudeTaskUpdateArgsSchema,
  claudeTaskUpdateOutputSchema,
} from "@bb/domain";
import type { ThreadEventWithMeta } from "./build-event-projection.js";
import { getOrderedThreadEvents } from "./group-event-projection-turns.js";

const TODO_TEXT_MAX_LENGTH = 240;

const KNOWN_TODO_WRITE_STATUSES: ReadonlySet<ThreadTimelinePendingTodoItemStatus> =
  new Set(["pending", "in_progress", "completed"]);

// Tolerant at the provider boundary: each item is shape-checked but unknown
// status values drop the *item*, not the whole payload. The whole-payload
// reject only fires when the args don't have a usable `todos` array at all
// (truly malformed input from a provider) — losing the entire snapshot for a
// single new status (e.g. provider adds "cancelled") would silently kill the
// banner.
const todoWriteTodoSchema = z
  .object({
    activeForm: z.string().optional(),
    content: z.string(),
    status: z.string(),
  })
  .passthrough();

const todoWriteArgsSchema = z.object({
  todos: z.array(z.unknown()),
});

export interface ParsedTodoWriteTodo {
  activeForm?: string;
  content: string;
  status: ThreadTimelinePendingTodoItemStatus;
}

export interface ParsedTodoWriteArgs {
  todos: ParsedTodoWriteTodo[];
}

function trimAndTruncate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TODO_TEXT_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, TODO_TEXT_MAX_LENGTH);
}

function isKnownTodoStatus(
  value: string,
): value is ThreadTimelinePendingTodoItemStatus {
  switch (value) {
    case "pending":
    case "in_progress":
    case "completed":
      return KNOWN_TODO_WRITE_STATUSES.has(value);
    default:
      return false;
  }
}

/**
 * Canonical TodoWrite arguments parser. Returns null only when the args don't
 * have a `todos` array at all. Items with unknown status values, missing
 * content, or shape mismatches are dropped individually so the snapshot
 * survives partial provider drift.
 */
export function parseTodoWriteTodos(
  rawArgs: unknown,
): ParsedTodoWriteArgs | null {
  const result = todoWriteArgsSchema.safeParse(rawArgs);
  if (!result.success) return null;
  const todos: ParsedTodoWriteTodo[] = [];
  for (const rawTodo of result.data.todos) {
    const itemResult = todoWriteTodoSchema.safeParse(rawTodo);
    if (!itemResult.success) continue;
    const todo = itemResult.data;
    if (!isKnownTodoStatus(todo.status)) continue;
    const content = trimAndTruncate(todo.content);
    if (content.length === 0) continue;
    const activeForm =
      todo.activeForm !== undefined
        ? trimAndTruncate(todo.activeForm)
        : null;
    todos.push({
      ...(activeForm && activeForm.length > 0 ? { activeForm } : {}),
      content,
      status: todo.status,
    });
  }
  return { todos };
}

function todoWriteText(todo: ParsedTodoWriteTodo): string {
  if (todo.status === "in_progress" && todo.activeForm !== undefined) {
    return todo.activeForm;
  }
  return todo.content;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return value;
  }
}

function taskText(task: ClaudeTaskTodoItem): string | null {
  const text =
    task.status === "in_progress" && task.activeForm !== null
      ? task.activeForm
      : task.subject;
  const trimmed = trimAndTruncate(text);
  return trimmed.length > 0 ? trimmed : null;
}

function taskStateSnapshotCandidate(
  state: ClaudeTaskTodoState,
  meta: SnapshotCandidateMeta,
): SnapshotCandidate {
  const items: ThreadTimelinePendingTodoItem[] = [];
  for (const task of state.tasks.values()) {
    const text = taskText(task);
    if (text === null) continue;
    items.push({
      id: `task:${task.id}`,
      text,
      status: task.status,
    });
  }
  return {
    seq: meta.seq,
    createdAt: meta.createdAt,
    items,
  };
}

function isSameTask(
  left: ClaudeTaskTodoItem,
  right: ClaudeTaskTodoItem,
): boolean {
  return (
    left.activeForm === right.activeForm &&
    left.id === right.id &&
    left.status === right.status &&
    left.subject === right.subject
  );
}

interface SnapshotCandidate {
  seq: number;
  createdAt: number;
  /** null indicates an unparseable candidate. */
  items: ThreadTimelinePendingTodoItem[] | null;
}

interface SnapshotCandidateMeta {
  createdAt: number;
  seq: number;
}

interface ClaudeTaskTodoItem {
  activeForm: string | null;
  id: string;
  status: ThreadTimelinePendingTodoItemStatus;
  subject: string;
}

interface ClaudeTaskTodoState {
  tasks: Map<string, ClaudeTaskTodoItem>;
}

function todoIdFor(seq: number, index: number): string {
  return `seq:${seq}:${index}`;
}

function extractTodoWriteCandidate(
  event: ThreadEvent,
  meta: { seq: number; createdAt: number },
): SnapshotCandidate | null {
  if (event.type !== "item/started" && event.type !== "item/completed") {
    return null;
  }
  if (event.item.type !== "toolCall" || event.item.tool !== "TodoWrite") {
    return null;
  }
  const parsed = parseTodoWriteTodos(event.item.arguments);
  if (!parsed) {
    return {
      seq: meta.seq,
      createdAt: meta.createdAt,
      items: null,
    };
  }
  const items: ThreadTimelinePendingTodoItem[] = parsed.todos.map(
    (todo, index) => ({
      id: todoIdFor(meta.seq, index),
      text: todoWriteText(todo),
      status: todo.status,
    }),
  );
  return {
    seq: meta.seq,
    createdAt: meta.createdAt,
    items,
  };
}

function extractTaskCreateCandidate(
  event: ThreadEvent,
  meta: SnapshotCandidateMeta,
  state: ClaudeTaskTodoState,
): SnapshotCandidate | null {
  if (event.type !== "item/completed") return null;
  if (
    event.item.type !== "toolCall" ||
    event.item.tool !== "TaskCreate" ||
    event.item.status !== "completed"
  ) {
    return null;
  }

  const parsedArgs = claudeTaskCreateArgsSchema.safeParse(
    event.item.arguments,
  );
  if (!parsedArgs.success) return null;
  const parsedResult = claudeTaskCreateOutputSchema.safeParse(
    parseMaybeJson(event.item.result),
  );
  if (!parsedResult.success) return null;

  const activeForm =
    parsedArgs.data.activeForm !== undefined
      ? trimAndTruncate(parsedArgs.data.activeForm)
      : null;
  const subject = trimAndTruncate(
    parsedArgs.data.subject.length > 0
      ? parsedArgs.data.subject
      : parsedResult.data.task.subject,
  );
  state.tasks.set(parsedResult.data.task.id, {
    activeForm: activeForm && activeForm.length > 0 ? activeForm : null,
    id: parsedResult.data.task.id,
    status: "pending",
    subject,
  });

  return taskStateSnapshotCandidate(state, meta);
}

function extractTaskUpdateCandidate(
  event: ThreadEvent,
  meta: SnapshotCandidateMeta,
  state: ClaudeTaskTodoState,
): SnapshotCandidate | null {
  if (event.type !== "item/completed") return null;
  if (
    event.item.type !== "toolCall" ||
    event.item.tool !== "TaskUpdate" ||
    event.item.status !== "completed"
  ) {
    return null;
  }

  const parsedArgs = claudeTaskUpdateArgsSchema.safeParse(
    event.item.arguments,
  );
  if (!parsedArgs.success) return null;

  const parsedResult = claudeTaskUpdateOutputSchema.safeParse(
    parseMaybeJson(event.item.result),
  );
  if (!parsedResult.success || !parsedResult.data.success) return null;

  const update = parsedArgs.data;
  if (update.status === "deleted") {
    if (!state.tasks.delete(update.taskId)) return null;
    return taskStateSnapshotCandidate(state, meta);
  }

  const existing = state.tasks.get(update.taskId);
  if (!existing) return null;

  const activeForm =
    update.activeForm !== undefined
      ? trimAndTruncate(update.activeForm)
      : existing.activeForm;
  const subject =
    update.subject !== undefined
      ? trimAndTruncate(update.subject)
      : existing.subject;
  const nextTask: ClaudeTaskTodoItem = {
    activeForm: activeForm && activeForm.length > 0 ? activeForm : null,
    id: update.taskId,
    status: update.status ?? existing.status,
    subject,
  };
  if (isSameTask(existing, nextTask)) return null;
  state.tasks.set(update.taskId, nextTask);

  return taskStateSnapshotCandidate(state, meta);
}

function extractTaskListCandidate(
  event: ThreadEvent,
  meta: SnapshotCandidateMeta,
  state: ClaudeTaskTodoState,
): SnapshotCandidate | null {
  if (event.type !== "item/completed") return null;
  if (
    event.item.type !== "toolCall" ||
    event.item.tool !== "TaskList" ||
    event.item.status !== "completed"
  ) {
    return null;
  }

  const parsedResult = claudeTaskListOutputSchema.safeParse(
    parseMaybeJson(event.item.result),
  );
  if (!parsedResult.success) return null;

  state.tasks.clear();
  for (const rawTask of parsedResult.data.tasks) {
    const parsedTask = claudeTaskListItemSchema.safeParse(rawTask);
    if (!parsedTask.success) continue;
    const task = parsedTask.data;
    // TaskList is treated as a snapshot of visible tasks; deleted entries are
    // explicit tombstones and should not drop valid siblings.
    if (task.status === "deleted") continue;
    state.tasks.set(task.id, {
      activeForm: null,
      id: task.id,
      status: task.status,
      subject: task.subject,
    });
  }

  return taskStateSnapshotCandidate(state, meta);
}

function extractTaskGetCandidate(
  event: ThreadEvent,
  meta: SnapshotCandidateMeta,
  state: ClaudeTaskTodoState,
): SnapshotCandidate | null {
  if (event.type !== "item/completed") return null;
  if (
    event.item.type !== "toolCall" ||
    event.item.tool !== "TaskGet" ||
    event.item.status !== "completed"
  ) {
    return null;
  }

  const parsedArgs = claudeTaskGetArgsSchema.safeParse(event.item.arguments);
  if (!parsedArgs.success) return null;
  const parsedResult = claudeTaskGetOutputSchema.safeParse(
    parseMaybeJson(event.item.result),
  );
  if (!parsedResult.success) return null;

  if (parsedResult.data.task === null) {
    if (!state.tasks.delete(parsedArgs.data.taskId)) return null;
    return taskStateSnapshotCandidate(state, meta);
  }

  const task = parsedResult.data.task;
  const existing = state.tasks.get(task.id);
  const nextTask: ClaudeTaskTodoItem = {
    activeForm: existing?.activeForm ?? null,
    id: task.id,
    status: task.status,
    subject: task.subject,
  };
  if (existing && isSameTask(existing, nextTask)) return null;
  state.tasks.set(task.id, nextTask);

  return taskStateSnapshotCandidate(state, meta);
}

function extractTaskCandidate(
  event: ThreadEvent,
  meta: SnapshotCandidateMeta,
  state: ClaudeTaskTodoState,
): SnapshotCandidate | null {
  return (
    extractTaskCreateCandidate(event, meta, state) ??
    extractTaskUpdateCandidate(event, meta, state) ??
    extractTaskListCandidate(event, meta, state) ??
    extractTaskGetCandidate(event, meta, state)
  );
}

/**
 * Walks decoded thread events and emits the latest valid TODO snapshot.
 * Treated like `activeThinking`: only meaningful while the thread has an
 * active turn. Returns null when the thread is idle/errored/etc., when no
 * candidate event was observed, or when every candidate failed to parse.
 *
 * TodoWrite carries complete legacy snapshots. Claude Task tools carry deltas
 * or snapshots, so this walks ordered events and reduces
 * TaskCreate/TaskUpdate/TaskList/TaskGet into a current snapshot.
 */
export function extractThreadTimelinePendingTodos(
  threadStatus: Thread["status"],
  events: readonly ThreadEventWithMeta[],
): ThreadTimelinePendingTodos | null {
  if (threadStatus !== "active") return null;

  let best: SnapshotCandidate | null = null;
  const taskState: ClaudeTaskTodoState = { tasks: new Map() };
  for (const { event, meta } of getOrderedThreadEvents(events)) {
    const candidate =
      extractTodoWriteCandidate(event, meta) ??
      extractTaskCandidate(event, meta, taskState);
    if (!candidate || candidate.items === null) continue;
    if (best === null || candidate.seq > best.seq) {
      best = candidate;
    }
  }
  if (best === null || best.items === null) return null;
  return {
    sourceSeq: best.seq,
    updatedAt: best.createdAt,
    items: best.items,
  };
}
