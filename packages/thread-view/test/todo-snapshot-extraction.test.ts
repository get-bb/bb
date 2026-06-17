import { jsonObjectSchema, turnScope } from "@bb/domain";
import type {
  ClaudeTaskToolName,
  Thread,
  ThreadEventItemStatus,
  ThreadEventPlanStep,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  extractThreadTimelinePendingTodos,
  parseTodoWriteTodos,
} from "../src/todo-snapshot-extraction.js";
import type { ThreadEventWithMeta } from "../src/build-event-projection.js";

const ACTIVE: Thread["status"] = "active";

interface TodoWriteEventArgs {
  itemId?: string;
  seq: number;
  status?: ThreadEventItemStatus;
  todos: unknown;
  type?: "item/started" | "item/completed";
}

interface TurnPlanEventArgs {
  plan: ThreadEventPlanStep[];
  seq: number;
}

interface TaskToolEventArgs {
  args?: Record<string, unknown>;
  itemId?: string;
  result?: unknown;
  seq: number;
  status?: ThreadEventItemStatus;
  tool: ClaudeTaskToolName;
}

function todoWriteEvent({
  itemId = "tool-call-1",
  seq,
  status,
  todos,
  type = "item/completed",
}: TodoWriteEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "toolCall",
        id: itemId,
        tool: "TodoWrite",
        arguments: jsonObjectSchema.parse({ todos }),
        status: status ?? (type === "item/completed" ? "completed" : "pending"),
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function taskToolEvent({
  args = {},
  itemId = "task-tool-call-1",
  result,
  seq,
  status = "completed",
  tool,
}: TaskToolEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "item/completed",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "toolCall",
        id: itemId,
        tool,
        arguments: jsonObjectSchema.parse(args),
        status,
        ...(result !== undefined ? { result } : {}),
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function turnPlanEvent({ plan, seq }: TurnPlanEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "turn/plan/updated",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      plan,
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function nonTodoToolCallEvent(seq: number): ThreadEventWithMeta {
  return {
    event: {
      type: "item/completed",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "toolCall",
        id: "tool-call-other",
        tool: "Read",
        arguments: { path: "README.md" },
        status: "completed",
      },
    },
    meta: { id: `event-${seq}`, seq, createdAt: seq },
  };
}

describe("extractThreadTimelinePendingTodos", () => {
  it("returns null when no TodoWrite or plan events are observed", () => {
    expect(extractThreadTimelinePendingTodos(ACTIVE, [])).toBeNull();
    expect(
      extractThreadTimelinePendingTodos(ACTIVE, [nonTodoToolCallEvent(1)]),
    ).toBeNull();
  });

  it("returns the latest TodoWrite snapshot when only TodoWrite events exist", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 10,
        todos: [
          { content: "Old item", status: "pending" },
          { content: "Old doing", status: "in_progress" },
        ],
      }),
      todoWriteEvent({
        seq: 20,
        todos: [
          { content: "New doing", status: "in_progress" },
          { content: "New pending", status: "pending" },
        ],
      }),
    ]);
    expect(result).toEqual({
      sourceSeq: 20,
      updatedAt: 20,
      items: [
        { id: "seq:20:0", text: "New doing", status: "in_progress" },
        { id: "seq:20:1", text: "New pending", status: "pending" },
      ],
    });
  });

  it("uses TodoWrite activeForm for in-progress items", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 10,
        todos: [
          {
            content: "Run the test suite",
            status: "in_progress",
            activeForm: "Running the test suite",
          },
          {
            content: "Update docs",
            status: "pending",
            activeForm: "Updating docs",
          },
          {
            content: "Ship fix",
            status: "completed",
            activeForm: "Shipping fix",
          },
        ],
      }),
    ]);
    expect(result).toMatchObject({
      sourceSeq: 10,
      items: [
        { text: "Running the test suite", status: "in_progress" },
        { text: "Update docs", status: "pending" },
        { text: "Ship fix", status: "completed" },
      ],
    });
  });

  it("reduces Claude TaskCreate and TaskUpdate events into pending todos", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      taskToolEvent({
        seq: 10,
        tool: "TaskCreate",
        args: {
          subject: "Add parser",
          activeForm: "Adding parser",
        },
        result: { task: { id: "task-1", subject: "Add parser" } },
      }),
      taskToolEvent({
        seq: 20,
        tool: "TaskCreate",
        args: {
          subject: "Add tests",
          activeForm: "Adding tests",
        },
        result: { task: { id: "task-2", subject: "Add tests" } },
      }),
      taskToolEvent({
        seq: 30,
        tool: "TaskUpdate",
        args: {
          taskId: "task-1",
          status: "in_progress",
        },
        result: { success: true, taskId: "task-1", updatedFields: ["status"] },
      }),
      taskToolEvent({
        seq: 40,
        tool: "TaskUpdate",
        args: {
          taskId: "task-2",
          status: "completed",
        },
        result: { success: true, taskId: "task-2", updatedFields: ["status"] },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 40,
      updatedAt: 40,
      items: [
        { id: "task:task-1", text: "Adding parser", status: "in_progress" },
        { id: "task:task-2", text: "Add tests", status: "completed" },
      ],
    });
  });

  it("deletes Claude Task items when TaskUpdate status is deleted", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      taskToolEvent({
        seq: 10,
        tool: "TaskCreate",
        args: {
          subject: "Keep",
        },
        result: { task: { id: "task-keep", subject: "Keep" } },
      }),
      taskToolEvent({
        seq: 20,
        tool: "TaskCreate",
        args: {
          subject: "Remove",
        },
        result: { task: { id: "task-remove", subject: "Remove" } },
      }),
      taskToolEvent({
        seq: 30,
        tool: "TaskUpdate",
        args: {
          taskId: "task-remove",
          status: "deleted",
        },
        result: { success: true, taskId: "task-remove" },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 30,
      updatedAt: 30,
      items: [{ id: "task:task-keep", text: "Keep", status: "pending" }],
    });
  });

  it("replaces Claude Task state from a TaskList result", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      taskToolEvent({
        seq: 10,
        tool: "TaskCreate",
        args: {
          subject: "Stale task",
        },
        result: { task: { id: "task-stale", subject: "Stale task" } },
      }),
      taskToolEvent({
        seq: 20,
        tool: "TaskList",
        result: {
          tasks: [
            {
              id: "task-current",
              subject: "Current task",
              status: "in_progress",
              blockedBy: [],
            },
          ],
        },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 20,
      updatedAt: 20,
      items: [
        {
          id: "task:task-current",
          text: "Current task",
          status: "in_progress",
        },
      ],
    });
  });

  it("filters invalid and deleted TaskList items without dropping valid siblings", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      taskToolEvent({
        seq: 20,
        tool: "TaskList",
        result: {
          tasks: [
            {
              id: "task-valid",
              subject: "Valid task",
              status: "pending",
              blockedBy: [],
            },
            {
              id: "task-unknown-status",
              subject: "Unknown status",
              status: "blocked",
              blockedBy: [],
            },
            {
              id: "task-deleted",
              subject: "Deleted task",
              status: "deleted",
              blockedBy: [],
            },
          ],
        },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 20,
      updatedAt: 20,
      items: [{ id: "task:task-valid", text: "Valid task", status: "pending" }],
    });
  });

  it("uses TaskGet to upsert, refresh, and remove known task state", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      taskToolEvent({
        seq: 10,
        tool: "TaskGet",
        args: { taskId: "task-1" },
        result: {
          task: {
            id: "task-1",
            subject: "Loaded task",
            status: "pending",
          },
        },
      }),
      taskToolEvent({
        seq: 20,
        tool: "TaskGet",
        args: { taskId: "task-1" },
        result: {
          task: {
            id: "task-1",
            subject: "Loaded task updated",
            status: "in_progress",
          },
        },
      }),
      taskToolEvent({
        seq: 30,
        tool: "TaskGet",
        args: { taskId: "task-1" },
        result: { task: null },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 30,
      updatedAt: 30,
      items: [],
    });
  });

  it("ignores TaskGet null results for unknown ids", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 10,
        todos: [{ content: "Keep todo", status: "pending" }],
      }),
      taskToolEvent({
        seq: 20,
        tool: "TaskGet",
        args: { taskId: "unknown-task" },
        result: { task: null },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 10,
      updatedAt: 10,
      items: [{ id: "seq:10:0", text: "Keep todo", status: "pending" }],
    });
  });

  it("does not let unknown TaskUpdate deletes displace earlier snapshots", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 10,
        todos: [{ content: "Keep todo", status: "pending" }],
      }),
      taskToolEvent({
        seq: 20,
        tool: "TaskUpdate",
        args: {
          taskId: "missing-task",
          status: "deleted",
        },
        result: { success: true, taskId: "missing-task" },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 10,
      updatedAt: 10,
      items: [{ id: "seq:10:0", text: "Keep todo", status: "pending" }],
    });
  });

  it("does not synthesize unknown TaskUpdate ids into tasks", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 10,
        todos: [{ content: "Keep todo", status: "pending" }],
      }),
      taskToolEvent({
        seq: 20,
        tool: "TaskUpdate",
        args: {
          taskId: "missing-task",
          subject: "Phantom task",
          activeForm: "Creating phantom task",
          status: "in_progress",
        },
        result: { success: true, taskId: "missing-task" },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 10,
      updatedAt: 10,
      items: [{ id: "seq:10:0", text: "Keep todo", status: "pending" }],
    });
  });

  it("reduces Task tool events in sequence order even when input is unordered", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      taskToolEvent({
        seq: 30,
        tool: "TaskUpdate",
        args: {
          taskId: "task-1",
          status: "in_progress",
        },
        result: { success: true, taskId: "task-1" },
      }),
      taskToolEvent({
        seq: 10,
        tool: "TaskCreate",
        args: {
          subject: "Ordered task",
          activeForm: "Ordering task",
        },
        result: { task: { id: "task-1", subject: "Ordered task" } },
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 30,
      updatedAt: 30,
      items: [
        { id: "task:task-1", text: "Ordering task", status: "in_progress" },
      ],
    });
  });

  it("parses stringified Claude Task tool results from older persisted events", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      taskToolEvent({
        seq: 10,
        tool: "TaskCreate",
        args: {
          subject: "Persisted task",
        },
        result: JSON.stringify({
          task: { id: "task-string", subject: "Persisted task" },
        }),
      }),
    ]);

    expect(result).toEqual({
      sourceSeq: 10,
      updatedAt: 10,
      items: [
        { id: "task:task-string", text: "Persisted task", status: "pending" },
      ],
    });
  });

  it("returns the latest turn/plan/updated snapshot when only plan events exist", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      turnPlanEvent({
        seq: 5,
        plan: [{ step: "old step", status: "pending" }],
      }),
      turnPlanEvent({
        seq: 12,
        plan: [
          { step: "step a", status: "active" },
          { step: "step b", status: "pending" },
          { step: "step c", status: "completed" },
        ],
      }),
    ]);
    expect(result).toEqual({
      sourceSeq: 12,
      updatedAt: 12,
      items: [
        { id: "seq:12:0", text: "step a", status: "in_progress" },
        { id: "seq:12:1", text: "step b", status: "pending" },
        { id: "seq:12:2", text: "step c", status: "completed" },
      ],
    });
  });

  it("picks the newest by seq across mixed TodoWrite and plan sources", () => {
    const todoOlder = todoWriteEvent({
      seq: 30,
      todos: [{ content: "todo first", status: "pending" }],
    });
    const planNewer = turnPlanEvent({
      seq: 40,
      plan: [{ step: "plan won", status: "active" }],
    });
    expect(
      extractThreadTimelinePendingTodos(ACTIVE, [todoOlder, planNewer]),
    ).toMatchObject({
      sourceSeq: 40,
      items: [{ text: "plan won", status: "in_progress" }],
    });
    const todoNewer = todoWriteEvent({
      seq: 50,
      todos: [{ content: "todo won", status: "in_progress" }],
    });
    expect(
      extractThreadTimelinePendingTodos(ACTIVE, [planNewer, todoNewer]),
    ).toMatchObject({
      sourceSeq: 50,
      items: [{ text: "todo won", status: "in_progress" }],
    });
  });

  it("prefers item/completed over an earlier item/started for the same TodoWrite call", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 7,
        type: "item/started",
        todos: [{ content: "started form", status: "pending" }],
      }),
      todoWriteEvent({
        seq: 8,
        type: "item/completed",
        todos: [{ content: "completed form", status: "in_progress" }],
      }),
    ]);
    expect(result).toMatchObject({
      sourceSeq: 8,
      items: [{ text: "completed form", status: "in_progress" }],
    });
  });

  it("falls through unparseable candidates to the newest valid snapshot", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 100,
        todos: [{ content: "valid older", status: "pending" }],
      }),
      todoWriteEvent({
        seq: 200,
        todos: "this is not an array",
      }),
    ]);
    expect(result).toMatchObject({
      sourceSeq: 100,
      items: [{ text: "valid older", status: "pending" }],
    });
  });

  it("returns null when every candidate fails to parse", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({ seq: 50, todos: "garbage" }),
      todoWriteEvent({ seq: 60, todos: { not: "todos" } }),
    ]);
    expect(result).toBeNull();
  });

  it("emits an empty snapshot for a parsed-empty candidate and prevents an older snapshot from resurfacing", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 5,
        todos: [{ content: "stale work", status: "pending" }],
      }),
      todoWriteEvent({ seq: 25, todos: [] }),
    ]);
    expect(result).toEqual({
      sourceSeq: 25,
      updatedAt: 25,
      items: [],
    });
  });

  it("drops failed plan steps and skips empty step text", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      turnPlanEvent({
        seq: 9,
        plan: [
          { step: "kept active", status: "active" },
          { step: "dropped failure", status: "failed" },
          { step: "   ", status: "pending" },
          { step: "kept pending" },
        ],
      }),
    ]);
    expect(result).toEqual({
      sourceSeq: 9,
      updatedAt: 9,
      items: [
        { id: "seq:9:0", text: "kept active", status: "in_progress" },
        { id: "seq:9:3", text: "kept pending", status: "pending" },
      ],
    });
  });

  it("ignores tool calls that are not TodoWrite", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      nonTodoToolCallEvent(1),
      nonTodoToolCallEvent(2),
    ]);
    expect(result).toBeNull();
  });

  it("observes TodoWrite events even though they are suppressed from rendered timeline rows", () => {
    // tool-call-suppression hides TodoWrite rows from the rendered timeline,
    // but extraction walks the raw event stream and must still pick them up.
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 11,
        status: "completed",
        todos: [{ content: "still seen", status: "in_progress" }],
      }),
    ]);
    expect(result).toMatchObject({
      sourceSeq: 11,
      items: [{ text: "still seen", status: "in_progress" }],
    });
  });

  it.each<Thread["status"]>([
    "idle",
    "starting",
    "stopping",
    "error",
  ])(
    "returns null when the thread status is %s, even with valid TodoWrite snapshots",
    (status) => {
      const result = extractThreadTimelinePendingTodos(status, [
        todoWriteEvent({
          seq: 1,
          todos: [{ content: "stale doing", status: "in_progress" }],
        }),
      ]);
      expect(result).toBeNull();
    },
  );

  it("keeps the snapshot when the turn is active and every item is completed", () => {
    const result = extractThreadTimelinePendingTodos(ACTIVE, [
      todoWriteEvent({
        seq: 42,
        todos: [
          { content: "first", status: "completed" },
          { content: "second", status: "completed" },
        ],
      }),
    ]);
    expect(result).toEqual({
      sourceSeq: 42,
      updatedAt: 42,
      items: [
        { id: "seq:42:0", text: "first", status: "completed" },
        { id: "seq:42:1", text: "second", status: "completed" },
      ],
    });
  });
});

describe("parseTodoWriteTodos", () => {
  it("returns null for non-record input", () => {
    expect(parseTodoWriteTodos(null)).toBeNull();
    expect(parseTodoWriteTodos("string")).toBeNull();
    expect(parseTodoWriteTodos(undefined)).toBeNull();
  });

  it("returns null only when the top-level todos array is missing or wrong shape", () => {
    expect(parseTodoWriteTodos({})).toBeNull();
    expect(parseTodoWriteTodos({ todos: "not-an-array" })).toBeNull();
  });

  it("drops items missing required fields rather than rejecting the whole payload", () => {
    const result = parseTodoWriteTodos({
      todos: [
        { status: "pending" }, // missing content
        { content: "kept", status: "pending" },
      ],
    });
    expect(result).toEqual({
      todos: [{ content: "kept", status: "pending" }],
    });
  });

  it("drops items with unknown status values and keeps the rest", () => {
    const result = parseTodoWriteTodos({
      todos: [
        { content: "kept", status: "pending" },
        { content: "dropped", status: "cancelled" }, // future provider drift
      ],
    });
    expect(result).toEqual({
      todos: [{ content: "kept", status: "pending" }],
    });
  });

  it("trims and drops empty content", () => {
    const result = parseTodoWriteTodos({
      todos: [
        { content: "  kept  ", status: "pending" },
        { content: "   ", status: "in_progress" },
      ],
    });
    expect(result).toEqual({
      todos: [{ content: "kept", status: "pending" }],
    });
  });

  it("truncates content past the max length", () => {
    const long = "a".repeat(300);
    const parsed = parseTodoWriteTodos({
      todos: [{ content: long, status: "pending" }],
    });
    expect(parsed?.todos[0]?.content.length).toBe(240);
  });

  it("keeps activeForm when present", () => {
    const result = parseTodoWriteTodos({
      todos: [
        {
          content: "Update docs",
          status: "in_progress",
          activeForm: "Updating docs",
        },
      ],
    });
    expect(result).toEqual({
      todos: [
        {
          activeForm: "Updating docs",
          content: "Update docs",
          status: "in_progress",
        },
      ],
    });
  });
});
