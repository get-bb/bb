import { describe, expect, it } from "vitest";
import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import type { ProviderRuntimeEvent } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
} from "./bridge-protocol.js";
import { createAcpEventTranslator } from "./event-translation.js";

const THREAD_ID = "t-acp-translation";
const context = { threadId: THREAD_ID };

function turnStartedEvent(): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: ACP_TURN_STARTED_METHOD,
    params: { threadId: THREAD_ID },
  };
}

function turnCompletedEvent(stopReason: string): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: ACP_TURN_COMPLETED_METHOD,
    params: { threadId: THREAD_ID, stopReason },
  };
}

function updateEvent(update: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: ACP_UPDATE_METHOD,
    params: { threadId: THREAD_ID, update },
  };
}

function fsWriteEvent(path: string): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: ACP_FS_WRITE_METHOD,
    params: { threadId: THREAD_ID, path, kind: "add" },
  };
}

function completedItems(events: ThreadEvent[]) {
  return events.flatMap((event) =>
    event.type === "item/completed" ? [event.item] : [],
  );
}

describe("acp event translation (bridge-shared invariants)", () => {
  // Historical fix 0c2f4cc9a: an update arriving after turn completion must
  // not fabricate a fresh bb turn. A synthetic turn/started here would open a
  // turn that never completes, wedging the thread.
  it("does not synthesize a turn for updates that arrive after turn completion", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });
    translator.translateAcpEvent(turnStartedEvent(), context);
    translator.translateAcpEvent(turnCompletedEvent("end_turn"), context);

    const lateChunk = translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late text" },
      }),
      context,
    );
    const lateToolCall = translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "late-call",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "ls" },
      }),
      context,
    );

    for (const events of [lateChunk, lateToolCall]) {
      expect(events.length).toBeGreaterThan(0);
      // Only dropped/unhandled output — no turn lifecycle, no items.
      expect(events.every((event) => event.type === "provider/unhandled")).toBe(
        true,
      );
    }
    expect(translator.resolveState(context).currentTurnId).toBeUndefined();
  });

  // Historical fix d32be7fab: a tool call that starts as one item type and
  // terminally re-classifies in an update must settle BOTH items. Settling
  // only the re-classified item leaves the originally started item
  // in-progress forever.
  it("settles both items when a terminal tool_call_update changes the item type", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });
    translator.translateAcpEvent(turnStartedEvent(), context);

    const startedEvents = translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Read file",
        kind: "read",
        status: "in_progress",
      }),
      context,
    );
    expect(startedEvents).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({ type: "toolCall", id: "call-1" }),
      }),
    );

    const terminalEvents = translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/tmp/a.ts",
            oldText: "old",
            newText: "new",
          },
        ],
      }),
      context,
    );
    const settled = completedItems(terminalEvents);
    expect(settled.map((item) => item.type).sort()).toEqual([
      "fileChange",
      "toolCall",
    ]);
    for (const item of settled) {
      expect(item.id).toBe("call-1");
    }

    // The call is fully settled: turn completion must not re-settle it.
    const endEvents = translator.translateAcpEvent(
      turnCompletedEvent("end_turn"),
      context,
    );
    expect(completedItems(endEvents)).toEqual([]);
    expect(endEvents).toContainEqual(
      expect.objectContaining({ type: "turn/completed", status: "completed" }),
    );
  });

  it("settles both items at turn end when a non-terminal update changed the item type", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });
    translator.translateAcpEvent(turnStartedEvent(), context);
    translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "Edit file",
        kind: "read",
        status: "in_progress",
      }),
      context,
    );
    translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-2",
        status: "in_progress",
        content: [
          { type: "diff", path: "/tmp/b.ts", oldText: "x", newText: "y" },
        ],
      }),
      context,
    );

    const endEvents = translator.translateAcpEvent(
      turnCompletedEvent("end_turn"),
      context,
    );
    const settled = completedItems(endEvents).filter(
      (item) => item.id === "call-2",
    );
    expect(settled.map((item) => item.type).sort()).toEqual([
      "fileChange",
      "toolCall",
    ]);
  });

  // Historical fix f60cf84ee: fs-write item ids are turn-scoped. A resumed
  // session gets a fresh translator whose per-thread counter restarts at 1,
  // so a bare `acp-fs-write-<counter>` id would collide with ids already
  // persisted by the pre-resume session.
  it("mints distinct fs-write item ids across sessions whose counters restart", () => {
    function firstFsWriteItemId(turnIdPrefix: string): string {
      // Each translator models one bridge session; the bridge injects
      // per-session entropy into the turn-id prefix (#1224).
      const translator = createAcpEventTranslator({
        providerId: "acp",
        turnIdPrefix,
      });
      translator.translateAcpEvent(turnStartedEvent(), context);
      const events = translator.translateAcpEvent(
        fsWriteEvent("/tmp/file.ts"),
        context,
      );
      const item = completedItems(events).find(
        (candidate) => candidate.type === "fileChange",
      );
      if (!item) {
        throw new Error("Expected acp/fs/write to complete a fileChange item");
      }
      return item.id;
    }

    const beforeResumeId = firstFsWriteItemId("s1-turn-");
    const afterResumeId = firstFsWriteItemId("s2-turn-");

    expect(beforeResumeId).not.toBe(afterResumeId);
    // Turn-scoped: the id embeds the minting turn's id.
    expect(beforeResumeId).toContain("s1-turn-1");
    expect(afterResumeId).toContain("s2-turn-1");
  });
});

/**
 * Content-mapping invariants moved here from the deleted legacy ACP adapter
 * test. The adapter forwarded `translateEvent` straight to this translator,
 * which the canonical bridge now owns; the bridge suite asserts the raw ACP
 * dialect, so these ThreadEvent shapes have no other home.
 */
describe("acp event translation (moved from the legacy adapter suite)", () => {
  function compactionStartedEvent(): ProviderRuntimeEvent {
    return {
      jsonrpc: "2.0",
      method: ACP_COMPACTION_STARTED_METHOD,
      params: { threadId: THREAD_ID },
    };
  }

  function compactionCompletedEvent(
    params: Record<string, unknown>,
  ): ProviderRuntimeEvent {
    return {
      jsonrpc: "2.0",
      method: ACP_COMPACTION_COMPLETED_METHOD,
      params: { threadId: THREAD_ID, ...params },
    };
  }

  it("translates successful maintenance prompts into a compaction lifecycle", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });

    const started = translator.translateAcpEvent(
      compactionStartedEvent(),
      context,
    );
    const completed = translator.translateAcpEvent(
      compactionCompletedEvent({ status: "completed" }),
      context,
    );

    expect(started.map((event) => event.type)).toEqual([
      "turn/started",
      "item/started",
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: "thread/compacted",
        scope: turnScope("turn-1"),
      }),
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    ]);
  });

  it("does not report failed maintenance prompts as compacted", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });
    translator.translateAcpEvent(compactionStartedEvent(), context);

    expect(
      translator.translateAcpEvent(
        compactionCompletedEvent({
          status: "failed",
          error: "Provider rejected /compact",
        }),
        context,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "failed",
        error: { message: "Provider rejected /compact" },
      }),
    ]);
  });

  it("completes streamed items before ending a compaction turn", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });
    translator.translateAcpEvent(compactionStartedEvent(), context);
    translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Compacted successfully" },
      }),
      context,
    );

    const events = translator.translateAcpEvent(
      compactionCompletedEvent({ status: "completed" }),
      context,
    );

    expect(events.map((event) => event.type)).toEqual([
      "item/completed",
      "thread/compacted",
      "turn/completed",
    ]);
    expect(events[0]).toMatchObject({
      item: { type: "agentMessage", text: "Compacted successfully" },
    });
  });

  function countChangedLines(diff: string | undefined): {
    added: number;
    removed: number;
  } {
    let added = 0;
    let removed = 0;
    for (const line of diff?.split("\n") ?? []) {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
      if (line.startsWith("+")) added += 1;
      if (line.startsWith("-")) removed += 1;
    }
    return { added, removed };
  }

  function startedTranslator() {
    const translator = createAcpEventTranslator({ providerId: "acp" });
    translator.translateAcpEvent(turnStartedEvent(), context);
    return translator;
  }

  it("translates ACP usage updates into exact context-window usage", () => {
    expect(
      startedTranslator().translateAcpEvent(
        updateEvent({
          sessionUpdate: "usage_update",
          used: 32_768,
          size: 200_000,
          cost: { amount: 0.42, currency: "USD" },
        }),
        context,
      ),
    ).toEqual([
      {
        type: "thread/contextWindowUsage/updated",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        contextWindowUsage: {
          usedTokens: 32_768,
          modelContextWindow: 200_000,
          estimated: false,
        },
      },
    ]);
  });

  it("reports ACP usage before a turn without creating a synthetic turn", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });

    expect(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "usage_update",
          used: 65_536,
          size: 1_000_000,
        }),
        context,
      ),
    ).toEqual([
      {
        type: "thread/contextWindowUsage/updated",
        threadId: "",
        providerThreadId: "",
        scope: threadScope(),
        contextWindowUsage: {
          usedTokens: 65_536,
          modelContextWindow: 1_000_000,
          estimated: false,
        },
      },
    ]);
  });

  it("ignores malformed ACP usage updates", () => {
    const translator = startedTranslator();

    expect(
      translator.translateAcpEvent(
        updateEvent({ sessionUpdate: "usage_update", used: -1, size: 200_000 }),
        context,
      ),
    ).toEqual([]);
    expect(
      translator.translateAcpEvent(
        updateEvent({ sessionUpdate: "usage_update", used: 1, size: "200000" }),
        context,
      ),
    ).toEqual([]);
  });

  it("accumulates thought chunks into a reasoning item", () => {
    const translator = startedTranslator();
    const thoughtEvents = translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Considering..." },
      }),
      context,
    );
    expect(thoughtEvents).toEqual([
      {
        type: "item/reasoning/textDelta",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        itemId: "acp-reasoning-1",
        delta: "Considering...",
      },
    ]);

    // The first message chunk closes the open thought item.
    const messageEvents = translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Answer" },
      }),
      context,
    );
    expect(messageEvents[0]).toEqual({
      type: "item/completed",
      threadId: "",
      providerThreadId: "",
      scope: turnScope("turn-1"),
      item: {
        type: "reasoning",
        id: "acp-reasoning-1",
        summary: [],
        content: ["Considering..."],
      },
    });
  });

  it("translates execute tool calls into command executions", () => {
    const translator = startedTranslator();

    expect(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "Run tests",
          kind: "execute",
          status: "in_progress",
          rawInput: { command: "pnpm test" },
        }),
        context,
      ),
    ).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "pnpm test",
          cwd: "",
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);

    expect(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          status: "completed",
          content: [
            { type: "content", content: { type: "text", text: "1 passed" } },
          ],
        }),
        context,
      ),
    ).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "pnpm test",
          cwd: "",
          status: "completed",
          approvalStatus: null,
          aggregatedOutput: "1 passed",
          exitCode: 0,
        },
      },
    ]);
  });

  it("translates diff tool calls into file changes", () => {
    const events = startedTranslator().translateAcpEvent(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "Edit file",
        kind: "edit",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "same\nold line\nsame\n",
            newText: "same\nnew line\nsame\n",
          },
        ],
      }),
      context,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: "call-2",
        status: "completed",
        changes: [{ path: "/workspace/a.ts", kind: "update" }],
      },
    });
    const change =
      events[0]?.type === "item/completed" &&
      events[0].item.type === "fileChange"
        ? events[0].item.changes[0]
        : undefined;
    // Only the changed lines travel in the diff.
    expect(change?.diff).toContain("-old line");
    expect(change?.diff).toContain("+new line");
    expect(change?.diff).not.toContain("-same");
    expect(change?.diff).not.toContain("+same");
    expect(countChangedLines(change?.diff)).toEqual({ added: 1, removed: 1 });
  });

  it("tracks Cursor edit calls as file changes before the final diff arrives", () => {
    const translator = startedTranslator();

    expect(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-edit",
          title: "Edit file",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/workspace/a.ts" }],
        }),
        context,
      ),
    ).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "fileChange",
          id: "call-edit",
          changes: [{ path: "/workspace/a.ts", kind: "update" }],
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);

    const completedEvents = translator.translateAcpEvent(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-edit",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "before\n",
            newText: "after\n",
          },
        ],
      }),
      context,
    );

    // One settled item: the started fileChange, not a second one.
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: "call-edit",
        status: "completed",
        changes: [{ path: "/workspace/a.ts", kind: "update" }],
      },
    });
    const change =
      completedEvents[0]?.type === "item/completed" &&
      completedEvents[0].item.type === "fileChange"
        ? completedEvents[0].item.changes[0]
        : undefined;
    expect(countChangedLines(change?.diff)).toEqual({ added: 1, removed: 1 });
  });

  it("translates plan updates", () => {
    expect(
      startedTranslator().translateAcpEvent(
        updateEvent({
          sessionUpdate: "plan",
          entries: [
            { content: "Read files", status: "completed" },
            { content: "Fix bug", status: "in_progress" },
            { content: "Run tests", status: "pending" },
          ],
        }),
        context,
      ),
    ).toEqual([
      {
        type: "turn/plan/updated",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        plan: [
          { step: "Read files", status: "completed" },
          { step: "Fix bug", status: "active" },
          { step: "Run tests", status: "pending" },
        ],
      },
    ]);
  });

  it("translates bridge warnings", () => {
    const translator = createAcpEventTranslator({ providerId: "acp" });

    expect(
      translator.translateAcpEvent(
        {
          jsonrpc: "2.0",
          method: ACP_WARNING_METHOD,
          params: { threadId: THREAD_ID, summary: "History not restored" },
        },
        context,
      ),
    ).toEqual([
      {
        type: "provider/warning",
        threadId: "",
        providerThreadId: "",
        scope: threadScope(),
        category: "general",
        summary: "History not restored",
      },
    ]);
  });

  it("fails the open turn on bridge errors", () => {
    expect(
      startedTranslator().translateAcpEvent(
        {
          jsonrpc: "2.0",
          method: "error",
          params: { threadId: THREAD_ID, message: "agent exploded" },
        },
        context,
      ),
    ).toEqual([
      {
        type: "provider/error",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: "agent exploded",
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "failed",
      },
    ]);
  });

  it("marks cancelled turns interrupted and refusals failed", () => {
    const translator = startedTranslator();

    expect(
      translator.translateAcpEvent(turnCompletedEvent("cancelled"), context),
    ).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "interrupted",
      },
    ]);

    translator.translateAcpEvent(turnStartedEvent(), context);
    expect(
      translator.translateAcpEvent(turnCompletedEvent("refusal"), context),
    ).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-2"),
        status: "failed",
        error: { message: "Agent stopped the turn: refusal" },
      },
    ]);
  });

  it("drops noise updates and reports unknown updates", () => {
    const translator = startedTranslator();

    expect(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "replayed" },
        }),
        context,
      ),
    ).toEqual([]);
    expect(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "session_info_update",
          title: "Tool Tester",
        }),
        context,
      ),
    ).toEqual([]);
    expect(
      translator.translateAcpEvent(
        updateEvent({ sessionUpdate: "totally_new_update" }),
        context,
      ),
    ).toMatchObject([
      { type: "provider/unhandled", rawType: "acp/update:totally_new_update" },
    ]);
  });
});
