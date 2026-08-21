import { describe, expect, it } from "vitest";
import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import type { ProviderRuntimeEvent } from "@bb/provider-bridge-protocol/bridge-kit";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { DeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
} from "./bridge-protocol.js";
import {
  createAcpDeltaTranslator,
  type AcpDeltaTranslator,
} from "./delta-translation.js";

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
        ? (
            startedEvents.find(
              (event) => event.type === "item/started",
            ) as Extract<ThreadEvent, { type: "item/started" }>
          ).item.id
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
          presentation: {
            label: { pending: "Running command", completed: "Ran command" },
            icon: { glyph: "Terminal" },
            title: "pnpm test",
          },
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
          presentation: {
            label: { pending: "Running command", completed: "Ran command" },
            icon: { glyph: "Terminal" },
            title: "pnpm test",
          },
        },
      },
    ]);
  });

  it("summarizes inline image attachments from raw tool output", () => {
    const events = startedHarness().translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "call-image",
        title: "Inspect image",
        kind: "other",
        status: "completed",
        rawOutput: {
          output: "",
          attachments: [
            {
              url: "data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+",
              contentType: "image/svg+xml",
            },
          ],
        },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "toolCall",
        result:
          '{"output":"","attachments":[{"url":"[image]","contentType":"image/svg+xml"}]}',
      },
    });
    expect(JSON.stringify(events)).not.toContain("PHN2Zy8+");
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
          presentation: {
            label: { pending: "Editing file", completed: "Edited file" },
            icon: { glyph: "EditFile" },
            title: "a.ts",
          },
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

  it("translates plan updates into settled planSteps snapshots", () => {
    const harness = startedHarness();
    const first = harness.translate(
      updateEvent({
        sessionUpdate: "plan",
        entries: [
          { content: "Read files", status: "completed" },
          { content: "Fix bug", status: "in_progress" },
          { content: "Run tests", status: "pending" },
        ],
      }),
    );
    expect(first).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(harness.openTurnId()),
        item: {
          type: "planSteps",
          id: expect.stringMatching(ITEM_ID_PATTERN),
          steps: [
            { step: "Read files", status: "completed" },
            { step: "Fix bug", status: "active" },
            { step: "Run tests", status: "pending" },
          ],
          status: "completed",
          presentation: {
            label: { pending: "Updating plan", completed: "Updated plan" },
            icon: { glyph: "ListTodo" },
            suppress: true,
            title: "Fix bug",
          },
        },
      },
    ]);
    // Each snapshot is its own item; the latest supersedes the rest.
    const second = completedItems(
      harness.translate(
        updateEvent({
          sessionUpdate: "plan",
          entries: [{ content: "Run tests", status: "in_progress" }],
        }),
      ),
    );
    expect(second).toHaveLength(1);
    expect(second[0]?.id).not.toBe(completedItems(first)[0]?.id);
    expect(first.some((event) => event.type === "turn/plan/updated")).toBe(
      false,
    );
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

/**
 * Grammar v3: every item the bridge opens or closes carries its presentation
 * (docs/provider-plugin-api.md §3), asserted on the deltas themselves so a
 * new lifecycle site cannot ship without one.
 */
describe("acp delta translation (presentation)", () => {
  function itemDeltas(
    deltas: ReturnType<AcpDeltaTranslator["translateAcpEvent"]>,
  ) {
    return deltas.filter(
      (delta) => delta.kind === "item.open" || delta.kind === "item.close",
    );
  }

  it("attaches a presentation to every item.open and item.close", () => {
    const translator = createAcpDeltaTranslator();
    const context = { threadId: THREAD_ID };
    const translate = (event: ProviderRuntimeEvent) =>
      translator.translateAcpEvent(event, context);

    translate(turnStartedEvent());
    const lifecycle = [
      ...translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-exec",
          title: "`pnpm test`",
          kind: "execute",
          status: "pending",
          rawInput: { command: "pnpm test" },
        }),
      ),
      ...translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-read",
          title: "Read File",
          kind: "read",
          status: "in_progress",
        }),
      ),
      ...translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-mcp",
          title: "MCP: tool",
          kind: "other",
          status: "completed",
        }),
      ),
      ...translate(
        updateEvent({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-exec",
          status: "completed",
        }),
      ),
      ...translate(fsWriteEvent("/tmp/new.ts")),
      // Turn end settles the still-open read.
      ...translate(turnCompletedEvent("end_turn")),
      ...translate({
        jsonrpc: "2.0",
        method: ACP_COMPACTION_STARTED_METHOD,
        params: { threadId: THREAD_ID },
      }),
    ];

    const items = itemDeltas(lifecycle);
    expect(items.map((delta) => delta.kind)).toEqual([
      "item.open",
      "item.open",
      "item.close",
      "item.close",
      "item.close",
      "item.close",
      "item.open",
    ]);
    for (const delta of items) {
      expect(delta.presentation).toBeDefined();
    }
    expect(items.map((delta) => delta.presentation)).toEqual([
      {
        label: { pending: "Running command", completed: "Ran command" },
        icon: { glyph: "Terminal" },
        title: "pnpm test",
      },
      {
        label: { pending: "Reading file", completed: "Read file" },
        icon: { glyph: "FileText" },
        title: "Read File",
      },
      {
        label: { pending: "Running tool", completed: "Ran tool" },
        icon: { glyph: "Toolbox" },
        title: "MCP: tool",
      },
      {
        label: { pending: "Running command", completed: "Ran command" },
        icon: { glyph: "Terminal" },
        title: "pnpm test",
      },
      {
        label: { pending: "Writing file", completed: "Wrote file" },
        icon: { glyph: "EditFile" },
        title: "new.ts",
      },
      {
        label: { pending: "Reading file", completed: "Read file" },
        icon: { glyph: "FileText" },
        title: "Read File",
      },
      {
        label: {
          pending: "Compacting context",
          completed: "Compacted context",
        },
        icon: { glyph: "Archive" },
      },
    ]);
  });

  it("strips the agent's code ticks from a command headline and names deleted files", () => {
    const translator = createAcpDeltaTranslator();
    const context = { threadId: THREAD_ID };
    translator.translateAcpEvent(turnStartedEvent(), context);
    const [command] = itemDeltas(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-title",
          title: "`touch approved.txt`",
          kind: "execute",
          status: "pending",
        }),
        context,
      ),
    );
    expect(command?.presentation?.title).toBe("touch approved.txt");

    const [deletion] = itemDeltas(
      translator.translateAcpEvent(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-delete",
          title: "Delete old.ts",
          kind: "delete",
          status: "completed",
          locations: [{ path: "/workspace/old.ts" }],
        }),
        context,
      ),
    );
    expect(deletion?.presentation).toEqual({
      label: { pending: "Deleting file", completed: "Deleted file" },
      icon: { glyph: "Trash2" },
      title: "old.ts",
    });
  });
});

/**
 * The native kind enum maps straight onto the core kinds; the agent's title
 * is the headline, never the tool name. A kind whose core shape the agent
 * left unfilled stays a generic tool presenting as its kind.
 */
describe("acp delta translation (native kinds → core kinds)", () => {
  function openItem(update: Record<string, unknown>) {
    const harness = createHarness();
    harness.translate(turnStartedEvent());
    const events = harness.translate(
      updateEvent({ sessionUpdate: "tool_call", status: "pending", ...update }),
    );
    const started = events.find((event) => event.type === "item/started");
    if (started?.type !== "item/started") {
      throw new Error(
        `Expected an item/started, got ${JSON.stringify(events)}`,
      );
    }
    return started.item;
  }

  it("maps a read with a location to fileRead", () => {
    expect(
      openItem({
        toolCallId: "read-1",
        title: "Read File",
        kind: "read",
        locations: [{ path: "/workspace/src/a.ts", line: 3 }],
      }),
    ).toMatchObject({
      type: "fileRead",
      path: "/workspace/src/a.ts",
      presentation: {
        label: { pending: "Reading file", completed: "Read file" },
        icon: { glyph: "FileText" },
        title: "a.ts",
      },
    });
  });

  it("recovers the read path from a single code-ticked title token", () => {
    expect(
      openItem({
        toolCallId: "read-2",
        title: "Read `/home/user/project/README.md`",
        kind: "read",
        rawInput: {},
      }),
    ).toMatchObject({ type: "fileRead", path: "/home/user/project/README.md" });
  });

  it("keeps a read with no path a generic tool that presents as a read", () => {
    expect(
      openItem({
        toolCallId: "read-3",
        title: "Read File",
        kind: "read",
        rawInput: {},
      }),
    ).toEqual(
      expect.objectContaining({
        type: "toolCall",
        tool: "read",
        presentation: {
          label: { pending: "Reading file", completed: "Read file" },
          icon: { glyph: "FileText" },
          title: "Read File",
        },
      }),
    );
  });

  it("maps a fetch to webFetch when the URL is known", () => {
    expect(
      openItem({
        toolCallId: "fetch-1",
        title: "Fetch: https://example.com/docs",
        kind: "fetch",
      }),
    ).toMatchObject({
      type: "webFetch",
      url: "https://example.com/docs",
      pattern: null,
      presentation: {
        label: { pending: "Fetching page", completed: "Fetched page" },
        title: "https://example.com/docs",
      },
    });
    expect(
      openItem({ toolCallId: "fetch-2", title: "Web Fetch", kind: "fetch" }),
    ).toMatchObject({
      type: "toolCall",
      tool: "fetch",
      presentation: { label: { pending: "Fetching" }, title: "Web Fetch" },
    });
  });

  it("maps a search with a query to the search kind", () => {
    expect(
      openItem({
        toolCallId: "search-1",
        title: "Grep",
        kind: "search",
        rawInput: { pattern: "TODO", path: "/workspace/src" },
      }),
    ).toMatchObject({
      type: "search",
      mode: "content",
      query: "TODO",
      path: "/workspace/src",
      presentation: { label: { completed: "Searched files" }, title: "TODO" },
    });
    expect(
      openItem({
        toolCallId: "search-2",
        title: "Find",
        kind: "search",
        rawInput: { glob: "**/*.test.ts" },
      }),
    ).toMatchObject({ type: "search", mode: "path", query: "**/*.test.ts" });
    expect(
      openItem({ toolCallId: "search-3", title: "Find", kind: "search" }),
    ).toMatchObject({ type: "toolCall", tool: "search" });
  });

  it("maps a think call to a reasoning item with its thought", () => {
    const harness = createHarness();
    harness.translate(turnStartedEvent());
    harness.translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "think-1",
        title: "Thinking",
        kind: "think",
        status: "in_progress",
      }),
    );
    const [settled] = completedItems(
      harness.translate(
        updateEvent({
          sessionUpdate: "tool_call_update",
          toolCallId: "think-1",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Plan: A then B" },
            },
          ],
        }),
      ),
    );
    expect(settled).toMatchObject({
      type: "reasoning",
      summary: [],
      content: ["Plan: A then B"],
      presentation: { label: { pending: "Thinking", completed: "Thought" } },
    });
  });

  it("names a generic call by its kind and keeps the title as the headline", () => {
    expect(
      openItem({ toolCallId: "other-1", title: "MCP: tool", kind: "other" }),
    ).toEqual(
      expect.objectContaining({
        type: "toolCall",
        tool: "other",
        presentation: {
          label: { pending: "Running tool", completed: "Ran tool" },
          icon: { glyph: "Toolbox" },
          title: "MCP: tool",
        },
      }),
    );
    expect(
      openItem({ toolCallId: "other-2", title: "Task: Subagent task" }),
    ).toMatchObject({ type: "toolCall", tool: "tool" });
  });
});

/**
 * Q31: a call to a bb-injected tool reads as that tool (`server: "bb"`, the
 * definition's presentation). ACP gives the bridge no id linking the MCP
 * proxy's call to the agent's own tool_call, so the binding is positional.
 */
describe("acp delta translation (bb-injected tools)", () => {
  const ASK_PRESENTATION = {
    label: { pending: "Asking a question", completed: "Asked a question" },
    icon: { glyph: "MessageQuestion" },
    suppress: true,
  };

  function injectedHarness() {
    const harness = createHarness();
    const translator = createAcpDeltaTranslator();
    translator.configureInjectedTools([
      { name: "ask_user_question", presentation: ASK_PRESENTATION },
      { name: "bb_workflow_run" },
    ]);
    const assembler = harness.assembler;
    const translate = (event: ProviderRuntimeEvent) =>
      assembler.assemble({
        threadId: THREAD_ID,
        deltas: translator.translateAcpEvent(event, { threadId: THREAD_ID }),
      });
    translate(turnStartedEvent());
    return { translate, translator };
  }

  it("binds the agent's announced MCP call when the proxy forwards the bb tool call", () => {
    const { translate, translator } = injectedHarness();
    // Cursor's order: the generic announcement first, then the MCP request
    // reaches the proxy, then the agent settles its call.
    const [started] = translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "mcp-1",
        title: "MCP: tool",
        kind: "other",
        status: "pending",
      }),
    );
    expect(started).toMatchObject({
      type: "item/started",
      item: { type: "toolCall", tool: "other" },
    });

    translator.noteInjectedToolCall(THREAD_ID, "ask_user_question");

    const [completed] = completedItems(
      translate(
        updateEvent({
          sessionUpdate: "tool_call_update",
          toolCallId: "mcp-1",
          status: "completed",
        }),
      ),
    );
    expect(completed).toMatchObject({
      type: "toolCall",
      server: "bb",
      tool: "ask_user_question",
      status: "completed",
      presentation: ASK_PRESENTATION,
    });
  });

  it("holds a proxied call until the agent announces it, and presents an unknown definition generically", () => {
    const { translate, translator } = injectedHarness();
    translator.noteInjectedToolCall(THREAD_ID, "bb_workflow_run");
    translator.noteInjectedToolCall(THREAD_ID, "not_configured");

    const first = completedItems(
      translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "mcp-2",
          title: "tool",
          status: "completed",
        }),
      ),
    );
    expect(first[0]).toMatchObject({
      type: "toolCall",
      server: "bb",
      tool: "bb_workflow_run",
      presentation: {
        label: {
          pending: "Running bb_workflow_run",
          completed: "Ran bb_workflow_run",
        },
        icon: { glyph: "Toolbox" },
      },
    });
    const second = completedItems(
      translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "mcp-3",
          title: "tool",
          kind: "other",
          status: "completed",
        }),
      ),
    );
    expect(second[0]).toMatchObject({
      type: "toolCall",
      server: "bb",
      tool: "not_configured",
    });
  });

  it("binds by name when the title names the tool, and never binds a command", () => {
    const { translate, translator } = injectedHarness();
    translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "exec-1",
        title: "`sleep 1`",
        kind: "execute",
        status: "pending",
        rawInput: { command: "sleep 1" },
      }),
    );
    const [named] = translate(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "mcp-4",
        title: "ask_user_question (bb-bridge MCP Server)",
        kind: "other",
        status: "pending",
      }),
    );
    expect(named).toMatchObject({
      type: "item/started",
      item: { type: "toolCall", server: "bb", tool: "ask_user_question" },
    });

    // A proxied call with only a command open waits; it never rebinds the
    // command or the already-bound question.
    translator.noteInjectedToolCall(THREAD_ID, "bb_workflow_run");
    const settled = completedItems(translate(turnCompletedEvent("end_turn")));
    expect(settled.map((item) => item.type)).toEqual([
      "commandExecution",
      "toolCall",
    ]);
    expect(settled[1]).toMatchObject({ tool: "ask_user_question" });
  });
});
