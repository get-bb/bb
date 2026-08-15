import { describe, expect, it } from "vitest";
import { createClaudeEventTranslator } from "./event-translation.js";

/**
 * Tool-use and tool-result translation on the bridge-shared translator.
 *
 * These invariants were pinned only by claude-code/adapter.test.ts, which was
 * deleted when the legacy adapter graduated. They outlive that suite because
 * they belong to event-translation.ts, the module the canonical Provider
 * Bridge Protocol surface shares with the legacy adapter — so they are
 * exercised here through the canonical construction the bridge uses.
 *
 * They live in this shard rather than in event-translation.test.ts purely for
 * volume: tool-call and tool-result mapping is the largest single group moved
 * off the adapter suite, and keeping it separate stops the base file from
 * becoming a grab bag.
 */

// Mirrors createCanonicalSessionTranslator in claude-code/bridge/bridge.ts.
function createTranslator() {
  return createClaudeEventTranslator({
    providerId: "claude-code",
    // The canonical bridge injects per-session entropy here (#1224); these
    // fixed prefixes reproduce the legacy id scheme so the moved assertions
    // stay readable.
    turnIdPrefix: "turn-",
    itemIdPrefix: "claude-",
    synthesizeItemStarted: true,
  });
}

describe("claude tool-use translation (bridge-shared translator)", () => {
  it("emits item/started for tool use blocks", () => {
    const translator = createTranslator();
    // First send an assistant message to start a turn
    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Let me check" }],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          status: "pending",
        }),
      }),
    );
  });

  it("falls back to a generic tool call when Bash args are malformed", () => {
    const translator = createTranslator();
    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Let me check" }],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: 42 },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-1",
          tool: "Bash",
          status: "pending",
        }),
      }),
    );
  });

  it("maps WebSearch and WebFetch tool uses into web items", () => {
    const translator = createTranslator();

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-search-1",
            name: "WebSearch",
            input: { query: "react suspense" },
          },
          {
            type: "tool_use",
            id: "tool-fetch-1",
            name: "WebFetch",
            input: { url: "https://example.com" },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "webSearch",
          id: "tool-search-1",
          queries: ["react suspense"],
          resultText: null,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "webFetch",
          id: "tool-fetch-1",
          url: "https://example.com",
          prompt: null,
          pattern: null,
          resultText: null,
        }),
      }),
    );
  });

  it("preserves completed WebSearch result text", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-search-1",
            name: "WebSearch",
            input: { query: "react suspense" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-search-1",
            content: "Found the Suspense docs",
            is_error: false,
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "webSearch",
          id: "tool-search-1",
          queries: ["react suspense"],
          resultText: "Found the Suspense docs",
        }),
      }),
    );
  });

  it("preserves completed WebFetch result text and prompt", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-fetch-1",
            name: "WebFetch",
            input: {
              url: "https://example.com",
              prompt: "page title",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-fetch-1",
            content: "Example Domain",
            is_error: false,
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "webFetch",
          id: "tool-fetch-1",
          url: "https://example.com",
          prompt: "page title",
          pattern: null,
          resultText: "Example Domain",
        }),
      }),
    );
  });

  it("emits fileChange items with diffs for Edit tool uses", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Let me patch that" }],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-edit-1",
            name: "Edit",
            input: {
              file_path: "src/app.ts",
              old_string: "const answer = 1;",
              new_string: "const answer = 2;",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "fileChange",
          id: "tool-edit-1",
          status: "pending",
          changes: [
            expect.objectContaining({
              path: "src/app.ts",
              diff: expect.stringContaining("const answer = 2;"),
            }),
          ],
        }),
      }),
    );
  });

  it("marks content-only Write tool uses as add changes", () => {
    const translator = createTranslator();

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-write-1",
            name: "Write",
            input: {
              path: "src/app.ts",
              content: "console.log('updated');\n",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    const started = events.find(
      (
        event,
      ): event is Extract<(typeof events)[number], { type: "item/started" }> =>
        event.type === "item/started",
    );
    expect(started?.item).toMatchObject({
      type: "fileChange",
      id: "tool-write-1",
      status: "pending",
      changes: [
        {
          path: "src/app.ts",
          kind: "add",
        },
      ],
    });
    if (!started || started.item.type !== "fileChange") return;
    expect(started.item.changes[0]?.diff).toContain("+++ b/src/app.ts");
  });

  it("preserves structured Agent arguments on tool calls", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Let me delegate that" }],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-agent-1",
            name: "Agent",
            input: {
              subagent_type: "Explore",
              description: "Inspect the docs tree",
              prompt: "List every markdown file",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-agent-1",
          tool: "Agent",
          status: "pending",
          arguments: expect.objectContaining({
            subagent_type: "Explore",
            description: "Inspect the docs tree",
            prompt: "List every markdown file",
          }),
        }),
      }),
    );
  });

  it("preserves structured Read, Grep, and Glob arguments on tool calls", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Let me inspect the repo" }],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-read-1",
            name: "Read",
            input: { file_path: "src/index.ts" },
          },
          {
            type: "tool_use",
            id: "tool-grep-1",
            name: "Grep",
            input: { pattern: "TODO", path: "src" },
          },
          {
            type: "tool_use",
            id: "tool-glob-1",
            name: "Glob",
            input: { pattern: "**/*.ts", path: "src" },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-read-1",
          tool: "Read",
          arguments: expect.objectContaining({
            file_path: "src/index.ts",
          }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-grep-1",
          tool: "Grep",
          arguments: expect.objectContaining({
            pattern: "TODO",
            path: "src",
          }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-glob-1",
          tool: "Glob",
          arguments: expect.objectContaining({
            pattern: "**/*.ts",
            path: "src",
          }),
        }),
      }),
    );
  });

  it("falls back to generic tool calls for malformed structured args", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Let me inspect that" }],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-read-bad-1",
            name: "Read",
            input: "not-an-object",
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-read-bad-1",
          tool: "Read",
          status: "pending",
        }),
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          id: "tool-read-bad-1",
          arguments: expect.anything(),
        }),
      }),
    );
  });

  it("preserves parent_tool_use_id on nested sdk/message events", () => {
    const translator = createTranslator();

    const events = translator.translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        message: {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Bash",
                input: { command: "ls" },
              },
            ],
          },
          parent_tool_use_id: "agent-parent-1",
          session_id: "sess-1",
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          parentToolCallId: "agent-parent-1",
        }),
      }),
    );
  });
});

describe("claude tool-result translation (bridge-shared translator)", () => {
  it("emits item/completed for user tool results", () => {
    const translator = createTranslator();
    // Start a turn
    translator.translateClaudeEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            content: "output text",
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          status: "completed",
        }),
      }),
    );
  });

  it("preserves structured TaskCreate tool results", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "task-create-1",
            name: "TaskCreate",
            input: {
              subject: "Add task support",
              description: "Track Claude Task tools",
              activeForm: "Adding task support",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-create-1",
            tool_name: "TaskCreate",
            content: {
              task: {
                id: "task-1",
                subject: "Add task support",
              },
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "toolCall",
          id: "task-create-1",
          tool: "TaskCreate",
          result: {
            task: {
              id: "task-1",
              subject: "Add task support",
            },
          },
          status: "completed",
        }),
      }),
    );
  });

  it("preserves structured TaskUpdate tool results", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "task-update-1",
            name: "TaskUpdate",
            input: {
              taskId: "task-1",
              status: "in_progress",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-update-1",
            tool_name: "TaskUpdate",
            content: {
              success: true,
              taskId: "task-1",
              updatedFields: ["status"],
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "toolCall",
          id: "task-update-1",
          tool: "TaskUpdate",
          result: {
            success: true,
            taskId: "task-1",
            updatedFields: ["status"],
          },
          status: "completed",
        }),
      }),
    );
  });

  it("preserves structured TaskList tool results", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "task-list-1",
            name: "TaskList",
            input: {},
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-list-1",
            tool_name: "TaskList",
            content: {
              tasks: [
                {
                  id: "task-1",
                  subject: "Add task support",
                  status: "pending",
                  blockedBy: [],
                },
              ],
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "toolCall",
          id: "task-list-1",
          tool: "TaskList",
          result: {
            tasks: [
              {
                id: "task-1",
                subject: "Add task support",
                status: "pending",
                blockedBy: [],
              },
            ],
          },
          status: "completed",
        }),
      }),
    );
  });

  it("preserves structured TaskGet tool results", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "task-get-1",
            name: "TaskGet",
            input: {
              taskId: "task-1",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-get-1",
            tool_name: "TaskGet",
            content: {
              task: {
                id: "task-1",
                subject: "Add task support",
                description: "Track Claude Task tools",
                status: "completed",
                blocks: [],
                blockedBy: [],
              },
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "toolCall",
          id: "task-get-1",
          tool: "TaskGet",
          result: {
            task: {
              id: "task-1",
              subject: "Add task support",
              description: "Track Claude Task tools",
              status: "completed",
              blocks: [],
              blockedBy: [],
            },
          },
          status: "completed",
        }),
      }),
    );
  });

  it("preserves structured Task results without a matching started item", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-update-late",
            tool_name: "TaskUpdate",
            content: JSON.stringify({
              success: true,
              taskId: "task-1",
              updatedFields: ["status"],
            }),
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "toolCall",
          id: "task-update-late",
          tool: "TaskUpdate",
          result: {
            success: true,
            taskId: "task-1",
            updatedFields: ["status"],
          },
          status: "completed",
        }),
      }),
    );
  });

  it("marks Bash tool results with is_error as failed", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "npm test", cwd: "/repo" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            content: "command failed",
            is_error: true,
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          command: "npm test",
          cwd: "/repo",
          aggregatedOutput: "command failed",
          exitCode: 1,
          status: "failed",
        }),
      }),
    );
  });

  it("prefers Claude stdout/stderr over placeholder Bash content", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "printf hi", cwd: "/repo" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            content: "(Bash completed with no output)",
            tool_use_result: {
              stdout: "hi\n",
              stderr: "",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          command: "printf hi",
          cwd: "/repo",
          aggregatedOutput: "hi\n",
          status: "completed",
        }),
      }),
    );
  });

  it("strips Claude no-output placeholders when stdout/stderr are empty", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "true", cwd: "/repo" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            content: "(Bash completed with no output)",
            tool_use_result: {
              stdout: "",
              stderr: "",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    const completedEvent = events.find(
      (
        event,
      ): event is Extract<
        (typeof events)[number],
        { type: "item/completed" }
      > => event.type === "item/completed",
    );

    expect(completedEvent?.item).toMatchObject({
      type: "commandExecution",
      id: "tool-1",
      command: "true",
      cwd: "/repo",
      status: "completed",
      exitCode: 0,
    });
    if (completedEvent?.item.type !== "commandExecution") {
      throw new Error("Expected commandExecution completion");
    }
    expect(completedEvent.item.aggregatedOutput).toBeUndefined();
  });

  it("inserts a newline between Claude stdout and stderr", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "printf hi; printf warn >&2", cwd: "/repo" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            content: "(Bash completed with no output)",
            tool_use_result: {
              stdout: "hi",
              stderr: "warn\n",
            },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          aggregatedOutput: "hi\nwarn\n",
          status: "completed",
        }),
      }),
    );
  });

  it("falls back to Claude content when tool_use_result streams are empty", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "cat output.txt", cwd: "/repo" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            content: "file output\n",
            tool_use_result: {},
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          command: "cat output.txt",
          cwd: "/repo",
          aggregatedOutput: "file output\n",
          status: "completed",
        }),
      }),
    );
  });

  it("preserves string tool_use_result errors for Bash completions", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "grep '(' file.txt", cwd: "/repo" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            content: "(Bash completed with no output)",
            is_error: true,
            tool_use_result:
              "Error: Exit code 2\ngrep: parentheses not balanced",
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-1",
          command: "grep '(' file.txt",
          cwd: "/repo",
          aggregatedOutput:
            "Error: Exit code 2\ngrep: parentheses not balanced",
          exitCode: 1,
          status: "failed",
        }),
      }),
    );
  });

  it("recovers missing tool names from prior tool uses", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Edit",
            input: { file_path: "notes/todo.txt" },
          },
        ],
      },
      session_id: "sess-1",
    });

    const events = translator.translateClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "updated",
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "fileChange",
          id: "tool-1",
          status: "completed",
        }),
      }),
    );
  });

  it("surfaces late tool results without turn context as unhandled", () => {
    const translator = createTranslator();

    translator.translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "npm test", cwd: "/repo" },
            },
          ],
        },
        session_id: "sess-1",
      },
      { threadId: "thread-1" },
    );

    translator.translateClaudeEvent(
      {
        type: "result",
        subtype: "end_turn",
        session_id: "sess-1",
      },
      { threadId: "thread-1" },
    );

    const events = translator.translateClaudeEvent(
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              tool_name: "Bash",
              content: "late output",
            },
          ],
        },
        session_id: "sess-1",
      },
      { threadId: "thread-1" },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
        rawType: "sdk/user:tool_result",
        scope: { kind: "thread" },
      }),
    );
  });
});
