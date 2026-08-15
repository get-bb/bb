import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import type { ServerNotification as CodexServerNotification } from "./generated/codex-app-server/schema/ServerNotification.js";
import type { Turn } from "./generated/codex-app-server/schema/v2/Turn.js";
import { createCodexEventTranslator } from "./translator.js";

/**
 * Per-event Codex translation invariants (codex/event-translation.ts).
 *
 * These moved off codex/adapter.test.ts, which was deleted when the codex
 * legacy adapter graduated. They outlive that adapter because
 * event-translation.ts and translator.ts are shared verbatim with the canonical
 * codex bridge: the legacy adapter's `translateEvent` was a pure pass-through to
 * `createCodexEventTranslator(...).translateEvent`, so every assertion here
 * still pins live bridge behavior.
 *
 * Split of responsibility with codex/translator.test.ts: that file keeps the
 * *stateful* correlation invariants — command-output recovery across event
 * reordering, subagent/delegation parent links, accepted-turn correlation —
 * which need multi-event sequences against one translator instance. This file
 * holds the per-event translation surface: one event in, translated bb events
 * out.
 */

function codexEvent<M extends CodexServerNotification["method"]>(
  method: M,
  params: Extract<CodexServerNotification, { method: M }>["params"],
) {
  return { jsonrpc: "2.0" as const, method, params };
}

function codexTurn(args: {
  id: string;
  status: Turn["status"];
  error: Turn["error"];
}): Turn {
  return {
    id: args.id,
    items: [],
    itemsView: "full",
    status: args.status,
    error: args.error,
    startedAt: 0,
    completedAt: null,
    durationMs: null,
  };
}

function createTranslator() {
  return createCodexEventTranslator({ additionalWorkspaceWriteRoots: [] });
}

// ---------------------------------------------------------------------------
// Envelope handling and turn lifecycle
// ---------------------------------------------------------------------------

describe("codex turn lifecycle translation", () => {
  it("translateEvent turn/started", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("turn/started", {
        threadId: "t1",
        turn: codexTurn({ id: "turn-1", status: "inProgress", error: null }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
      }),
    );
  });

  it("translateEvent accepts legacy Codex bridge envelopes without jsonrpc", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      method: "turn/started",
      params: {
        threadId: "t1",
        turn: codexTurn({ id: "turn-1", status: "inProgress", error: null }),
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
      }),
    );
  });

  it("translateEvent surfaces malformed handled Codex events as provider/unhandled", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "t1",
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "codex",
        rawType: "turn/started",
        threadId: "t1",
      }),
    );
  });

  it("translateEvent ignores resolved Codex server requests", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("serverRequest/resolved", {
        threadId: "t1",
        requestId: 0,
      }),
    );

    expect(events).toEqual([]);
  });

  it("translateEvent suppresses automatic review lifecycle notifications", () => {
    const translator = createTranslator();

    for (const method of [
      "item/autoApprovalReview/started",
      "item/autoApprovalReview/completed",
    ]) {
      expect(
        translator.translateEvent({
          jsonrpc: "2.0",
          method,
          params: {
            threadId: "t1",
            turnId: "turn-1",
            reviewId: "review-1",
          },
        }),
      ).toEqual([]);
    }
  });

  it("translateEvent turn/completed with status and error", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("turn/completed", {
        threadId: "t1",
        turn: codexTurn({
          id: "turn-1",
          status: "failed",
          error: {
            message: "rate limited",
            codexErrorInfo: null,
            additionalDetails: "try again",
          },
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        threadId: "t1",
        scope: turnScope("turn-1"),
        status: "failed",
        error: { message: "rate limited" },
      }),
    );
  });

  it("translateEvent turn/completed maps interrupted status", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("turn/completed", {
        threadId: "t1",
        turn: codexTurn({ id: "turn-1", status: "interrupted", error: null }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        status: "interrupted",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Thread lifecycle
// ---------------------------------------------------------------------------

describe("codex thread lifecycle translation", () => {
  it("translateEvent thread/started emits started + identity + name", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("thread/started", {
        thread: {
          id: "codex-uuid-123",
          sessionId: "session-1",
          forkedFromId: null,
          parentThreadId: null,
          preview: "Fix the tests",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: null,
          cwd: "/tmp",
          cliVersion: "0.1",
          source: "appServer",
          threadSource: null,
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: [],
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/started",
        threadId: "codex-uuid-123",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/identity",
        threadId: "codex-uuid-123",
        providerThreadId: "codex-uuid-123",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/name/updated",
        threadId: "codex-uuid-123",
        providerThreadId: "codex-uuid-123",
        threadName: "Fix the tests",
      }),
    );
  });

  it("translateEvent thread/name/updated", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("thread/name/updated", {
        threadId: "t1",
        threadName: "Updated title",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/name/updated",
        threadId: "t1",
        providerThreadId: "t1",
        threadName: "Updated title",
      }),
    );
  });

  it("translateEvent thread/name/updated ignores empty name", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("thread/name/updated", { threadId: "t1" }),
    );
    expect(events).toHaveLength(0);
  });

  it("translateEvent ignores native archive acknowledgements", () => {
    const translator = createTranslator();

    expect(
      translator.translateEvent(
        codexEvent("thread/archived", { threadId: "t1" }),
      ),
    ).toEqual([]);
    expect(
      translator.translateEvent(
        codexEvent("thread/unarchived", { threadId: "t1" }),
      ),
    ).toEqual([]);
  });

  it("translateEvent maps native thread goal notifications", () => {
    const translator = createTranslator();

    expect(
      translator.translateEvent(
        codexEvent("thread/goal/cleared", { threadId: "t1" }),
      ),
    ).toEqual([
      {
        type: "thread/goal/cleared",
        threadId: "t1",
        providerThreadId: "t1",
        scope: threadScope(),
      },
    ]);
    expect(
      translator.translateEvent(
        codexEvent("thread/goal/updated", {
          threadId: "t1",
          turnId: null,
          goal: {
            threadId: "t1",
            objective: "Finish the task",
            status: "active",
            tokenBudget: null,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        }),
      ),
    ).toEqual([
      {
        type: "thread/goal/updated",
        threadId: "t1",
        providerThreadId: "t1",
        scope: threadScope(),
        objective: "Finish the task",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
      },
    ]);
  });

  it("translateEvent thread/compacted emits a compacted event", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("thread/compacted", { threadId: "t1", turnId: "turn-1" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/compacted",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

describe("codex item translation", () => {
  it("translateEvent item/started with agentMessage", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "agentMessage",
          id: "item-1",
          text: "Hello",
          phase: null,
          memoryCitation: null,
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: { type: "agentMessage", id: "item-1", text: "Hello" },
      }),
    );
  });

  it("translateEvent item/started with userMessage is suppressed as a provider echo", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "userMessage",
          id: "user-1",
          clientId: null,
          content: [
            { type: "text", text: "hello", text_elements: [] },
            { type: "image", url: "https://example.com/image.png" },
            { type: "localImage", path: "/tmp/image.png" },
            { type: "skill", name: "repo-research", path: "/tmp/SKILL.md" },
          ],
        },
      }),
    );
    expect(events).toMatchObject([]);
  });

  it("translateEvent item/started with imageView maps to imageView", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "imageView",
          id: "image-1",
          path: "/tmp/image.png",
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "imageView",
          id: "image-1",
          path: "/tmp/image.png",
        },
      }),
    );
  });

  it("translateEvent item/completed with imageView maps to imageView", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "imageView",
          id: "image-1",
          path: "/tmp/image.png",
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "imageView",
          id: "image-1",
          path: "/tmp/image.png",
        },
      }),
    );
  });

  it("translateEvent unknown codex notifications fall back to provider/unhandled", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "t1",
        turnId: "turn-1",
      },
    });

    // Thread scope, not turnScope("turn-1"): this notification failed schema
    // parsing, so nothing here vouches for that turn id being one bb started.
    // Turn-scoping an event whose turn/started the server never stored gets the
    // event dropped; thread scope keeps it. Codex notifications bb *does* parse
    // still carry turn scope — see the handled item/started cases above.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "codex",
        rawType: "item/tool/requestUserInput",
        threadId: "t1",
        scope: threadScope(),
      }),
    );
  });

  it("translateEvent ignores Codex turn moderation metadata", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "turn/moderationMetadata",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        metadata: {
          prompt: {},
          generation: {},
          tool_call: {},
          tool_response: {},
        },
      },
    });

    expect(events).toEqual([]);
  });

  it("translateEvent ignores Codex raw response completions", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "rawResponse/completed",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        responseId: "response-1",
        usage: {
          totalTokens: 19_206,
          inputTokens: 18_971,
          cachedInputTokens: 11_008,
          cacheWriteInputTokens: 0,
          outputTokens: 235,
          reasoningOutputTokens: 53,
        },
      },
    });

    expect(events).toEqual([]);
  });

  it("translateEvent item/mcpToolCall/progress maps to shared tool progress", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/mcpToolCall/progress", {
        threadId: "t1",
        turnId: "turn-1",
        itemId: "mcp-1",
        message: "Connecting to MCP server",
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/toolCall/progress",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        itemId: "mcp-1",
        message: "Connecting to MCP server",
      }),
    );
  });

  it("translateEvent item/completed with commandExecution maps status", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "ls -la",
          cwd: "/tmp",
          processId: null,
          source: "agent",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "file1\nfile2",
          exitCode: 0,
          durationMs: 150,
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "commandExecution",
          id: "cmd-1",
          command: "ls -la",
          status: "completed",
          exitCode: 0,
          durationMs: 150,
        }),
      }),
    );
  });

  it("translateEvent item/completed with declined commandExecution maps approval denial", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "ls -la",
          cwd: "/tmp",
          processId: null,
          source: "agent",
          status: "declined",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "commandExecution",
          id: "cmd-1",
          status: "interrupted",
          approvalStatus: "denied",
        }),
      }),
    );
  });

  it("translateEvent item/started normalizes commandExecution to pending", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "ls -la",
          cwd: "/tmp",
          processId: null,
          source: "agent",
          status: "declined",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "commandExecution",
          id: "cmd-1",
          command: "ls -la",
          status: "pending",
          approvalStatus: null,
        }),
      }),
    );
  });

  it("translateEvent item/completed with fileChange maps kind correctly", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "fileChange",
          id: "fc-1",
          changes: [
            {
              path: "src/foo.ts",
              kind: { type: "update", move_path: null },
              diff: "+line",
            },
            { path: "src/bar.ts", kind: { type: "add" }, diff: "" },
          ],
          status: "completed",
        },
      }),
    );
    const itemEvent = events.find((e) => e.type === "item/completed");
    expect(itemEvent).toBeDefined();
    if (
      itemEvent?.type === "item/completed" &&
      itemEvent.item.type === "fileChange"
    ) {
      expect(itemEvent.item.changes).toMatchObject([
        {
          path: "src/foo.ts",
          kind: "update",
          diff: "+line",
        },
        {
          path: "src/bar.ts",
          kind: "add",
        },
      ]);
      expect(itemEvent.item.status).toBe("completed");
    }
  });

  it("translateEvent item/completed with mcpToolCall maps to toolCall", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "myserver",
          tool: "search",
          pluginId: null,
          status: "completed",
          arguments: { query: "test" },
          result: null,
          error: null,
          durationMs: 200,
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "toolCall",
          id: "mcp-1",
          server: "myserver",
          tool: "search",
          status: "completed",
          durationMs: 200,
        }),
      }),
    );
  });

  it("translateEvent item/completed with declined fileChange maps approval denial", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "fileChange",
          id: "edit-1",
          status: "declined",
          changes: [
            {
              path: "new.txt",
              kind: { type: "add" },
              diff: "+hello",
            },
          ],
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "fileChange",
          id: "edit-1",
          status: "interrupted",
          approvalStatus: "denied",
        }),
      }),
    );
  });

  it("translateEvent item/completed with dynamicToolCall maps to toolCall", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "dynamicToolCall",
          id: "dyn-1",
          namespace: null,
          tool: "bb_test_ping",
          arguments: {},
          status: "completed",
          contentItems: [{ type: "inputText", text: "PONG_FROM_TOOL" }],
          success: true,
          durationMs: 3,
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "toolCall",
          id: "dyn-1",
          tool: "bb_test_ping",
          status: "completed",
          result: "PONG_FROM_TOOL",
          durationMs: 3,
        }),
      }),
    );
  });

  it("translateEvent item/completed with failed dynamicToolCall preserves textual errors", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        item: {
          type: "dynamicToolCall",
          id: "dyn-err-1",
          namespace: null,
          tool: "bb_test_ping",
          arguments: {},
          status: "failed",
          contentItems: [{ type: "inputText", text: "permission denied" }],
          success: false,
          durationMs: 8,
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "toolCall",
          id: "dyn-err-1",
          status: "failed",
          result: "permission denied",
          error: "permission denied",
        }),
      }),
    );
  });

  it("translateEvent item/completed with image-only dynamicToolCall keeps readable output", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "dynamicToolCall",
          id: "dyn-img-1",
          namespace: null,
          tool: "bb_test_image",
          arguments: {},
          status: "failed",
          contentItems: [
            {
              type: "inputImage",
              imageUrl: "https://example.com/tool-result.png",
            },
          ],
          success: false,
          durationMs: 4,
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "toolCall",
          id: "dyn-img-1",
          status: "failed",
          result: "[image: https://example.com/tool-result.png]",
          error: "[image: https://example.com/tool-result.png]",
        }),
      }),
    );
  });

  it("translateEvent item/completed with collabAgentToolCall maps to toolCall", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "t1",
          receiverThreadIds: ["sub-thread-1"],
          prompt: "Inspect the docs directory",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          agentsStates: {
            "sub-thread-1": { status: "completed", message: "done" },
          },
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "toolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          arguments: expect.objectContaining({
            senderThreadId: "t1",
            receiverThreadIds: ["sub-thread-1"],
            prompt: "Inspect the docs directory",
            model: "gpt-5.4",
            reasoningEffort: "medium",
          }),
          result: {
            "sub-thread-1": { status: "completed", message: "done" },
          },
        }),
      }),
    );
  });

  it("translateEvent item/completed with declined collabAgentToolCall maps to interrupted", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        item: {
          type: "collabAgentToolCall",
          id: "collab-declined-1",
          tool: "spawnAgent",
          status: "declined",
          senderThreadId: "t1",
          receiverThreadIds: ["sub-thread-1"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agentsStates: {},
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "toolCall",
          id: "collab-declined-1",
          status: "interrupted",
        }),
      }),
    );
  });

  it("translateEvent item/completed with reasoning maps to reasoning", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: ["Read the search flow"],
          content: ["Investigated the search sidebar state machine."],
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: ["Read the search flow"],
          content: ["Investigated the search sidebar state machine."],
        },
      }),
    );
  });

  it("translateEvent item/completed with plan maps to plan", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "plan",
          id: "plan-1",
          text: "1. Read the file\n2. Edit the function",
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "plan",
          id: "plan-1",
          text: "1. Read the file\n2. Edit the function",
        },
      }),
    );
  });

  it("translateEvent item/started with contextCompaction maps to contextCompaction", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "contextCompaction",
          id: "compact-1",
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "contextCompaction",
          id: "compact-1",
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Web search / fetch items
// ---------------------------------------------------------------------------

describe("codex web item translation", () => {
  it("translateEvent item/completed with search maps to webSearch", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-1",
          query: "react suspense",
          action: { type: "search", query: "react suspense", queries: null },
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "webSearch",
          id: "web-1",
          queries: ["react suspense"],
          resultText: null,
        },
      }),
    );
  });

  it("translateEvent item/started with search maps to webSearch and merges query fields", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-start-1",
          query: "react suspense fallback",
          action: {
            type: "search",
            query: "react suspense primary",
            queries: ["react suspense primary", "react suspense secondary"],
          },
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "webSearch",
          id: "web-start-1",
          queries: [
            "react suspense primary",
            "react suspense secondary",
            "react suspense fallback",
          ],
          resultText: null,
        },
      }),
    );
  });

  it("translateEvent item/started with camelCase openPage maps to webFetch", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-open-start-1",
          query: "ignored fallback",
          action: { type: "openPage", url: "https://example.com" },
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "webFetch",
          id: "web-open-start-1",
          url: "https://example.com",
          prompt: null,
          pattern: null,
          resultText: null,
        },
      }),
    );
  });

  it("translateEvent item/started with camelCase findInPage maps to webFetch", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-find-start-1",
          query: "ignored fallback",
          action: {
            type: "findInPage",
            url: "https://example.com",
            pattern: "Example Domain",
          },
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "webFetch",
          id: "web-find-start-1",
          url: "https://example.com",
          prompt: null,
          pattern: "Example Domain",
          resultText: null,
        },
      }),
    );
  });

  it("translateEvent item/completed with camelCase openPage maps to webFetch", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-open-1",
          query: "https://example.com",
          action: { type: "openPage", url: "https://example.com" },
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "webFetch",
          id: "web-open-1",
          url: "https://example.com",
          prompt: null,
          pattern: null,
          resultText: null,
        },
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
      }),
    );
  });

  it("translateEvent item/completed with camelCase findInPage maps to webFetch", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-find-1",
          query: "https://example.com",
          action: {
            type: "findInPage",
            url: "https://example.com",
            pattern: "Example Domain",
          },
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: {
          type: "webFetch",
          id: "web-find-1",
          url: "https://example.com",
          prompt: null,
          pattern: "Example Domain",
          resultText: null,
        },
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
      }),
    );
  });

  it("translateEvent ignores placeholder webSearch started items without canonical details", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/started", {
        threadId: "t1",
        turnId: "turn-1",
        startedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-placeholder-1",
          query: "",
          action: { type: "other" },
        },
      }),
    );

    expect(events).toMatchObject([]);
  });

  it("translateEvent ignores placeholder webSearch completed items without canonical details", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-placeholder-completed-1",
          query: "",
          action: null,
        },
      }),
    );

    expect(events).toMatchObject([]);
  });

  it("translateEvent item/completed with missing openPage url falls back to provider/unhandled", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/completed", {
        threadId: "t1",
        turnId: "turn-1",
        completedAtMs: 0,
        item: {
          type: "webSearch",
          id: "web-open-missing-url-1",
          query: "not-a-url",
          action: { type: "openPage", url: null },
        },
      }),
    );

    expect(
      events.some(
        (event) =>
          event.type === "provider/unhandled" &&
          event.rawType === "item/completed",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "item/completed" && event.item.type === "webFetch",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Streaming deltas and token usage
// ---------------------------------------------------------------------------

describe("codex delta and usage translation", () => {
  it("translateEvent item/agentMessage/delta", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/agentMessage/delta", {
        threadId: "t1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: "hello ",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/agentMessage/delta",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        itemId: "item-1",
        delta: "hello ",
      }),
    );
  });

  it("translateEvent item/commandExecution/outputDelta", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("item/commandExecution/outputDelta", {
        threadId: "t1",
        turnId: "turn-1",
        itemId: "cmd-1",
        delta: "output line\n",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/commandExecution/outputDelta",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        itemId: "cmd-1",
        delta: "output line\n",
      }),
    );
  });

  it("translateEvent thread/tokenUsage/updated", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("thread/tokenUsage/updated", {
        threadId: "t1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            totalTokens: 100,
            inputTokens: 60,
            cachedInputTokens: 10,
            outputTokens: 30,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 50,
            inputTokens: 30,
            cachedInputTokens: 5,
            outputTokens: 15,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 128000,
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/tokenUsage/updated",
        threadId: "t1",
        tokenUsage: expect.objectContaining({
          total: expect.objectContaining({ totalTokens: 100 }),
          modelContextWindow: 128000,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/contextWindowUsage/updated",
        contextWindowUsage: {
          usedTokens: 50,
          modelContextWindow: 128000,
          estimated: false,
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Turn plan updates
// ---------------------------------------------------------------------------

describe("codex plan translation", () => {
  it("translateEvent turn/plan/updated maps step statuses", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("turn/plan/updated", {
        threadId: "t1",
        turnId: "turn-1",
        explanation: "Here's the plan",
        plan: [
          { step: "Read the file", status: "completed" },
          { step: "Edit the function", status: "inProgress" },
          { step: "Run tests", status: "pending" },
        ],
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/plan/updated",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        explanation: "Here's the plan",
        plan: [
          { step: "Read the file", status: "completed" },
          { step: "Edit the function", status: "active" },
          { step: "Run tests", status: "pending" },
        ],
      }),
    );
  });

  it("translateEvent turn/plan/updated tolerates null explanations", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      method: "turn/plan/updated",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        explanation: null,
        plan: [
          { step: "Read the file", status: "completed" },
          { step: "Run tests", status: "pending" },
        ],
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/plan/updated",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        plan: [
          { step: "Read the file", status: "completed" },
          { step: "Run tests", status: "pending" },
        ],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Errors and warnings
// ---------------------------------------------------------------------------

describe("codex error and warning translation", () => {
  it("translateEvent error includes detail and willRetry", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("error", {
        threadId: "t1",
        turnId: "turn-1",
        error: {
          message: "Rate limited",
          codexErrorInfo: null,
          additionalDetails: "retry after 30s",
        },
        willRetry: true,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/error",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: "Rate limited\nretry after 30s",
        willRetry: true,
      }),
    );
  });

  it("translateEvent error maps codexErrorInfo to provider error info", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("error", {
        threadId: "t1",
        turnId: "turn-1",
        error: {
          message: "stream disconnected",
          codexErrorInfo: {
            responseStreamDisconnected: { httpStatusCode: 502 },
          },
          additionalDetails: null,
        },
        willRetry: false,
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/error",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: "stream disconnected",
        willRetry: false,
        errorInfo: {
          category: "stream-disconnected",
          providerCode: "responseStreamDisconnected",
          httpStatusCode: 502,
        },
      }),
    );
  });

  it("translateEvent deprecationNotice maps to warning", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("deprecationNotice", {
        summary: "Model deprecated",
        details: "Use newer model",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/warning",
        threadId: "",
        providerThreadId: "",
        category: "deprecation",
        summary: "Model deprecated",
        details: "Use newer model",
      }),
    );
  });

  it("translateEvent configWarning maps to warning", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("configWarning", {
        summary: "Bad config",
        details: null,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/warning",
        threadId: "",
        providerThreadId: "",
        category: "config",
        summary: "Bad config",
      }),
    );
  });

  it("translateEvent ignores MCP startup status updates", () => {
    const translator = createTranslator();
    const failedEvents = translator.translateEvent({
      jsonrpc: "2.0",
      method: "mcpServer/startupStatus/updated",
      params: {
        name: "codex_apps",
        status: "failed",
        error: "MCP client failed to start",
      },
    });
    const readyEvents = translator.translateEvent({
      jsonrpc: "2.0",
      method: "mcpServer/startupStatus/updated",
      params: {
        name: "codex_apps",
        status: "ready",
        error: null,
      },
    });

    expect(failedEvents).toEqual([]);
    expect(readyEvents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Account rate limits
// ---------------------------------------------------------------------------

describe("codex account rate-limit translation", () => {
  it("translateEvent preserves Codex subscription rate limits", () => {
    const translator = createTranslator();
    const events = translator.translateEvent(
      codexEvent("account/rateLimits/updated", {
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          primary: {
            usedPercent: 100,
            windowDurationMins: 300,
            resetsAt: 1_781_120_400,
          },
          secondary: null,
          credits: null,
          individualLimit: null,
          planType: null,
          rateLimitReachedType: "rate_limit_reached",
        },
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/rateLimits/updated",
        scope: threadScope(),
        rateLimits: expect.objectContaining({
          providerId: "codex",
          status: "blocked",
          kind: "subscription-window",
          reachedReason: "rate_limit_reached",
          windows: [
            {
              providerKey: "primary",
              label: "Current session",
              status: "blocked",
              resetsAtMs: 1_781_120_400_000,
            },
          ],
        }),
      }),
    ]);
  });

  it("uses Codex's reached reason before credit and spend metadata", () => {
    const translator = createTranslator();
    const [event] = translator.translateEvent(
      codexEvent("account/rateLimits/updated", {
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          primary: {
            usedPercent: 100,
            windowDurationMins: 300,
            resetsAt: 1_781_120_400,
          },
          secondary: null,
          credits: {
            hasCredits: false,
            unlimited: false,
            balance: "0",
          },
          individualLimit: {
            limit: "100",
            used: "100",
            remainingPercent: 0,
            resetsAt: 1_781_120_400,
          },
          planType: "pro",
          rateLimitReachedType: "rate_limit_reached",
        },
      }),
    );

    expect(event).toMatchObject({
      type: "provider/rateLimits/updated",
      rateLimits: {
        status: "blocked",
        kind: "subscription-window",
        reachedReason: "rate_limit_reached",
      },
    });
  });

  it("hydrates Codex rate limits before merging truly sparse rolling updates", () => {
    const translator = createTranslator();
    const requests = translator.buildPostInitializeRequests();
    expect(requests).toHaveLength(1);
    const [rateLimitRead] = requests;
    if (rateLimitRead === undefined) {
      throw new Error("Expected a Codex rate-limit hydration request");
    }
    expect(rateLimitRead).toMatchObject({
      plan: { kind: "request", method: "account/rateLimits/read" },
      required: false,
    });
    rateLimitRead.onResult({
      rateLimits: {
        limitId: "codex",
        limitName: "Codex",
        primary: {
          usedPercent: 20,
          resetsAt: 1_781_120_400,
        },
        secondary: {
          usedPercent: 100,
          windowDurationMins: 10_080,
          resetsAt: 1_781_720_400,
        },
        planType: "pro",
        rateLimitReachedType: "rate_limit_reached",
      },
    });

    const [sparseEvent] = translator.translateEvent({
      jsonrpc: "2.0",
      method: "account/rateLimits/updated",
      params: {
        rateLimits: {
          primary: {
            usedPercent: 25,
            resetsAt: 1_781_120_400,
          },
        },
      },
    });
    expect(sparseEvent).toMatchObject({
      type: "provider/rateLimits/updated",
      rateLimits: {
        status: "blocked",
        kind: "subscription-window",
        reachedReason: "rate_limit_reached",
        windows: [
          { providerKey: "primary", status: "allowed" },
          {
            providerKey: "secondary",
            status: "blocked",
            resetsAtMs: 1_781_720_400_000,
          },
        ],
      },
    });

    const [resetEvent] = translator.translateEvent({
      jsonrpc: "2.0",
      method: "account/rateLimits/updated",
      params: {
        rateLimits: {
          secondary: {
            usedPercent: 30,
            resetsAt: 1_781_720_400,
          },
        },
      },
    });
    expect(resetEvent).toMatchObject({
      type: "provider/rateLimits/updated",
      rateLimits: {
        status: "allowed",
        kind: "subscription-window",
        reachedReason: null,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Notifications bb deliberately ignores
// ---------------------------------------------------------------------------

describe("codex ignored notifications", () => {
  it("translateEvent ignores remote control status changes", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "remoteControl/status/changed",
      params: {
        status: "disabled",
        environmentId: null,
      },
    });

    expect(events).toEqual([]);
  });

  it("translateEvent ignores thread settings updates", () => {
    const translator = createTranslator();
    const events = translator.translateEvent({
      jsonrpc: "2.0",
      method: "thread/settings/updated",
      params: {
        threadId: "t1",
        threadSettings: {
          cwd: "/tmp/project",
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: ["/tmp/thread-storage"],
            networkAccess: true,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
          activePermissionProfile: null,
          model: "gpt-5.5",
          modelProvider: "openai",
          serviceTier: null,
          effort: "xhigh",
          summary: null,
          collaborationMode: {
            mode: "default",
            settings: {
              model: "gpt-5.5",
              reasoning_effort: "xhigh",
              developer_instructions: null,
            },
          },
          personality: "pragmatic",
        },
      },
    });

    expect(events).toEqual([]);
  });
});
