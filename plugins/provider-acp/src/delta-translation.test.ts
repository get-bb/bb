import { describe, expect, it } from "vitest";
import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import type { ProviderRuntimeEvent } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  createDeltaAssembler,
  type DeltaAssembler,
} from "@bb/agent-runtime/test/bridge-delta-assembly";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
} from "./bridge-protocol.js";
import { createAcpDeltaTranslator } from "./delta-translation.js";

/**
 * ACP translation equivalence for the narrow-grammar path.
 *
 * These cases are the acp event-translation suite, ported so the SAME acp
 * envelopes drive the new pipeline: acp dialect events → semantic deltas →
 * the runtime delta assembler → canonical ThreadEvents. Event content,
 * ordering, scoping, and statuses are asserted exactly as before; ids are
 * asserted by shape and stability because minting moved from the bridge to
 * the assembler (turn ids are `<entropy>-tN` instead of `turn-N`, item ids
 * `<entropy>-iN` instead of provider tool-call ids / `acp-assistant-N`).
 */

const THREAD_ID = "t-acp-translation";
const ENTROPY = "acp-test";
const TURN_ID_PATTERN = /^acp-test-t\d+$/;
const ITEM_ID_PATTERN = /^acp-test-i\d+$/;

interface AcpEquivalenceHarness {
  assembler: DeltaAssembler;
  translate(event: ProviderRuntimeEvent): ThreadEvent[];
  openTurnId(): string;
}

function createHarness(): AcpEquivalenceHarness {
  const translator = createAcpDeltaTranslator();
  const assembler = createDeltaAssembler({
    providerId: "acp",
    entropyPrefix: ENTROPY,
    // Equivalence suites pin per-delta translation fidelity: no coalescing.
    textDeltaFlushMs: 0,
  });
  return {
    assembler,
    translate(event) {
      return assembler.assemble({
        threadId: THREAD_ID,
        deltas: translator.translateAcpEvent(event, { threadId: THREAD_ID }),
      });
    },
    openTurnId() {
      return assembler.getOpenTurnId(THREAD_ID) ?? "";
    },
  };
}

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
    params: { threadId: THREAD_ID, path, kind: "add", content: "hello\n" },
  };
}

function completedItems(events: ThreadEvent[]) {
  return events.flatMap((event) =>
    event.type === "item/completed" ? [event.item] : [],
  );
}

describe("acp delta translation (bridge-shared invariants)", () => {
  // Historical fix 0c2f4cc9a: an update arriving after turn completion must
  // not fabricate a fresh bb turn. A synthetic turn/started here would open a
  // turn that never completes, wedging the thread.
  it("does not synthesize a turn for updates that arrive after turn completion", () => {
    const harness = createHarness();
    harness.translate(turnStartedEvent());
    harness.translate(turnCompletedEvent("end_turn"));

    const lateChunk = harness.translate(
      updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late text" },
      }),
    );
    const lateToolCall = harness.translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "late-call",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "ls" },
      }),
    );

    for (const events of [lateChunk, lateToolCall]) {
      expect(events.length).toBeGreaterThan(0);
      // Only dropped/unhandled output — no turn lifecycle, no items.
      expect(events.every((event) => event.type === "provider/unhandled")).toBe(
        true,
      );
    }
    expect(harness.openTurnId()).toBe("");
  });

  // Historical fix d32be7fab: a tool call that starts as one item type and
  // terminally re-classifies in an update must settle BOTH items. Settling
  // only the re-classified item leaves the originally started item
  // in-progress forever.
  it("settles both items when a terminal tool_call_update changes the item type", () => {
    const harness = createHarness();
    harness.translate(turnStartedEvent());

    const startedEvents = harness.translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Read file",
        kind: "read",
        status: "in_progress",
      }),
    );
    expect(startedEvents).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: expect.stringMatching(ITEM_ID_PATTERN),
        }),
      }),
    );
    const startedItemId =
      startedEvents.find((event) => event.type === "item/started")?.type ===
      "item/started"
        ? (startedEvents.find(
            (event) => event.type === "item/started",
          ) as Extract<ThreadEvent, { type: "item/started" }>).item.id
        : "";

    const terminalEvents = harness.translate(
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
    );
    const settled = completedItems(terminalEvents);
    expect(settled.map((item) => item.type).sort()).toEqual([
      "fileChange",
      "toolCall",
    ]);
    for (const item of settled) {
      expect(item.id).toBe(startedItemId);
    }

    // The call is fully settled: turn completion must not re-settle it.
    const endEvents = harness.translate(turnCompletedEvent("end_turn"));
    expect(completedItems(endEvents)).toEqual([]);
    expect(endEvents).toContainEqual(
      expect.objectContaining({ type: "turn/completed", status: "completed" }),
    );
  });

  it("settles both items at turn end when a non-terminal update changed the item type", () => {
    const harness = createHarness();
    harness.translate(turnStartedEvent());
    harness.translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "Edit file",
        kind: "read",
        status: "in_progress",
      }),
    );
    harness.translate(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-2",
        status: "in_progress",
        content: [
          { type: "diff", path: "/tmp/b.ts", oldText: "x", newText: "y" },
        ],
      }),
    );

    const endEvents = harness.translate(turnCompletedEvent("end_turn"));
    const settled = completedItems(endEvents);
    expect(settled.map((item) => item.type).sort()).toEqual([
      "fileChange",
      "toolCall",
    ]);
  });

  // Historical fix f60cf84ee (recast): fs-write item ids must never collide
  // across writes or sessions. Minting moved to the runtime assembler, whose
  // per-assembler entropy+serial ids are unique across every session it sees.
  it("mints distinct fs-write item ids across writes", () => {
    const harness = createHarness();
    harness.translate(turnStartedEvent());
    const first = completedItems(
      harness.translate(fsWriteEvent("/tmp/file.ts")),
    ).find((item) => item.type === "fileChange");
    const second = completedItems(
      harness.translate(fsWriteEvent("/tmp/file.ts")),
    ).find((item) => item.type === "fileChange");
    if (!first || !second) {
      throw new Error("Expected acp/fs/write to complete fileChange items");
    }
    expect(first.id).toMatch(ITEM_ID_PATTERN);
    expect(second.id).toMatch(ITEM_ID_PATTERN);
    expect(first.id).not.toBe(second.id);
  });
});

/**
 * Content-mapping invariants moved here from the deleted legacy ACP adapter
 * test, asserted through the delta assembler exactly as the runtime builds
 * them.
 */
describe("acp delta translation (moved from the legacy adapter suite)", () => {
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
    const harness = createHarness();

    const started = harness.translate(compactionStartedEvent());
    const turnId = harness.openTurnId();
    expect(turnId).toMatch(TURN_ID_PATTERN);
    const completed = harness.translate(
      compactionCompletedEvent({ status: "completed" }),
    );

    expect(started.map((event) => event.type)).toEqual([
      "turn/started",
      "item/started",
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: "thread/compacted",
        scope: turnScope(turnId),
      }),
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(turnId),
        status: "completed",
      }),
    ]);
  });

  it("does not report failed maintenance prompts as compacted", () => {
    const harness = createHarness();
    harness.translate(compactionStartedEvent());
    const turnId = harness.openTurnId();

    expect(
      harness.translate(
        compactionCompletedEvent({
          status: "failed",
          error: "Provider rejected /compact",
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(turnId),
        status: "failed",
        error: { message: "Provider rejected /compact" },
      }),
    ]);
  });

  it("completes streamed items before ending a compaction turn", () => {
    const harness = createHarness();
    harness.translate(compactionStartedEvent());
    harness.translate(
      updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Compacted successfully" },
      }),
    );

    const events = harness.translate(
      compactionCompletedEvent({ status: "completed" }),
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

  function startedHarness(): AcpEquivalenceHarness {
    const harness = createHarness();
    harness.translate(turnStartedEvent());
    return harness;
  }

  it("translates ACP usage updates into exact context-window usage", () => {
    const harness = startedHarness();
    expect(
      harness.translate(
        updateEvent({
          sessionUpdate: "usage_update",
          used: 32_768,
          size: 200_000,
          cost: { amount: 0.42, currency: "USD" },
        }),
      ),
    ).toEqual([
      {
        type: "thread/contextWindowUsage/updated",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(harness.openTurnId()),
        contextWindowUsage: {
          usedTokens: 32_768,
          modelContextWindow: 200_000,
          estimated: false,
        },
      },
    ]);
  });

  it("reports ACP usage before a turn without creating a synthetic turn", () => {
    const harness = createHarness();

    expect(
      harness.translate(
        updateEvent({
          sessionUpdate: "usage_update",
          used: 65_536,
          size: 1_000_000,
        }),
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
    const harness = startedHarness();

    expect(
      harness.translate(
        updateEvent({ sessionUpdate: "usage_update", used: -1, size: 200_000 }),
      ),
    ).toEqual([]);
    expect(
      harness.translate(
        updateEvent({ sessionUpdate: "usage_update", used: 1, size: "200000" }),
      ),
    ).toEqual([]);
  });

  it("accumulates thought chunks into a reasoning item", () => {
    const harness = startedHarness();
    const turnId = harness.openTurnId();
    const thoughtEvents = harness.translate(
      updateEvent({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Considering..." },
      }),
    );
    // The canonical grammar opens every item with item/started (the bridge
    // opted into synthesis before; the assembler always synthesizes).
    expect(thoughtEvents.map((event) => event.type)).toEqual([
      "item/started",
      "item/reasoning/textDelta",
    ]);
    expect(thoughtEvents[1]).toEqual({
      type: "item/reasoning/textDelta",
      threadId: "",
      providerThreadId: "",
      scope: turnScope(turnId),
      itemId: expect.stringMatching(ITEM_ID_PATTERN),
      delta: "Considering...",
    });
    const reasoningItemId =
      thoughtEvents[1]?.type === "item/reasoning/textDelta"
        ? thoughtEvents[1].itemId
        : "";

    // The first message chunk closes the open thought item.
    const messageEvents = harness.translate(
      updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Answer" },
      }),
    );
    expect(messageEvents[0]).toEqual({
      type: "item/completed",
      threadId: "",
      providerThreadId: "",
      scope: turnScope(turnId),
      item: {
        type: "reasoning",
        id: reasoningItemId,
        summary: [],
        content: ["Considering..."],
      },
    });
  });

  it("translates execute tool calls into command executions", () => {
    const harness = startedHarness();
    const turnId = harness.openTurnId();

    const startedEvents = harness.translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Run tests",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "pnpm test" },
      }),
    );
    expect(startedEvents).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(turnId),
        item: {
          type: "commandExecution",
          id: expect.stringMatching(ITEM_ID_PATTERN),
          command: "pnpm test",
          cwd: "",
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);
    const startedItemId =
      startedEvents[0]?.type === "item/started" ? startedEvents[0].item.id : "";

    expect(
      harness.translate(
        updateEvent({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          status: "completed",
          content: [
            { type: "content", content: { type: "text", text: "1 passed" } },
          ],
        }),
      ),
    ).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(turnId),
        item: {
          type: "commandExecution",
          id: startedItemId,
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
    const events = startedHarness().translate(
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
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: expect.stringMatching(ITEM_ID_PATTERN),
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
    const harness = startedHarness();
    const turnId = harness.openTurnId();

    const startedEvents = harness.translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-edit",
        title: "Edit file",
        kind: "edit",
        status: "in_progress",
        locations: [{ path: "/workspace/a.ts" }],
      }),
    );
    expect(startedEvents).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(turnId),
        item: {
          type: "fileChange",
          id: expect.stringMatching(ITEM_ID_PATTERN),
          changes: [{ path: "/workspace/a.ts", kind: "update" }],
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);
    const startedItemId =
      startedEvents[0]?.type === "item/started" ? startedEvents[0].item.id : "";

    const completedEvents = harness.translate(
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
    );

    // One settled item: the started fileChange, not a second one.
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: startedItemId,
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
    const harness = startedHarness();
    expect(
      harness.translate(
        updateEvent({
          sessionUpdate: "plan",
          entries: [
            { content: "Read files", status: "completed" },
            { content: "Fix bug", status: "in_progress" },
            { content: "Run tests", status: "pending" },
          ],
        }),
      ),
    ).toEqual([
      {
        type: "turn/plan/updated",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(harness.openTurnId()),
        plan: [
          { step: "Read files", status: "completed" },
          { step: "Fix bug", status: "active" },
          { step: "Run tests", status: "pending" },
        ],
      },
    ]);
  });

  it("translates bridge warnings", () => {
    const harness = createHarness();

    expect(
      harness.translate({
        jsonrpc: "2.0",
        method: ACP_WARNING_METHOD,
        params: { threadId: THREAD_ID, summary: "History not restored" },
      }),
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
    const harness = startedHarness();
    const turnId = harness.openTurnId();
    expect(
      harness.translate({
        jsonrpc: "2.0",
        method: "error",
        params: { threadId: THREAD_ID, message: "agent exploded" },
      }),
    ).toEqual([
      {
        type: "provider/error",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(turnId),
        message: "Provider error",
        detail: "agent exploded",
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(turnId),
        status: "failed",
      },
    ]);
  });

  it("marks cancelled turns interrupted and refusals failed", () => {
    const harness = startedHarness();
    const firstTurnId = harness.openTurnId();

    expect(harness.translate(turnCompletedEvent("cancelled"))).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(firstTurnId),
        status: "interrupted",
      },
    ]);

    harness.translate(turnStartedEvent());
    const secondTurnId = harness.openTurnId();
    expect(secondTurnId).not.toBe(firstTurnId);
    expect(harness.translate(turnCompletedEvent("refusal"))).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(secondTurnId),
        status: "failed",
        error: { message: "Agent stopped the turn: refusal" },
      },
    ]);
  });

  it("drops noise updates and reports unknown updates", () => {
    const harness = startedHarness();

    expect(
      harness.translate(
        updateEvent({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "replayed" },
        }),
      ),
    ).toEqual([]);
    expect(
      harness.translate(
        updateEvent({
          sessionUpdate: "session_info_update",
          title: "Tool Tester",
        }),
      ),
    ).toEqual([]);
    expect(
      harness.translate(updateEvent({ sessionUpdate: "totally_new_update" })),
    ).toMatchObject([
      { type: "provider/unhandled", rawType: "acp/update:totally_new_update" },
    ]);
  });
});
