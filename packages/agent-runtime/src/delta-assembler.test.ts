import { describe, expect, it } from "vitest";
import type { ClientTurnRequestId, ThreadEvent } from "@bb/domain";
import { threadScope, turnScope } from "@bb/domain";
import type { ThreadDelta } from "@bb/provider-bridge-protocol";
import {
  createDeltaAssembler,
  diffCumulativeText,
  type DeltaAssembler,
} from "./delta-assembler.js";

const THREAD_ID = "thr_1";
const CREQ = "creq_abcdefghjk" as ClientTurnRequestId;
const CREQ_2 = "creq_bcdefghjkm" as ClientTurnRequestId;

function createAssembler(): DeltaAssembler {
  return createDeltaAssembler({ providerId: "pi", entropyPrefix: "as-test" });
}

function assemble(
  assembler: DeltaAssembler,
  ...deltas: ThreadDelta[]
): ThreadEvent[] {
  return assembler.assemble({ threadId: THREAD_ID, deltas });
}

function bashOpen(providerItemId: string): ThreadDelta {
  return {
    kind: "item.open",
    key: { providerItemId },
    item: { type: "command", command: "npm test", cwd: "/repo" },
  };
}

describe("delta assembler", () => {
  // -- accepted input --------------------------------------------------------

  it("queues accepted input and drains it right after turn/started", () => {
    const assembler = createAssembler();
    expect(assemble(assembler, { kind: "input.accepted", clientRequestId: CREQ })).toEqual([]);

    const events = assemble(assembler, { kind: "turn.open" });
    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
    ]);
    const accepted = events[1];
    expect(accepted).toMatchObject({
      clientRequestId: CREQ,
      scope: events[0]?.scope,
    });
  });

  it("emits accepted input immediately into an already-open turn", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const turnId = assembler.getOpenTurnId(THREAD_ID);
    const events = assemble(assembler, {
      kind: "input.accepted",
      clientRequestId: CREQ_2,
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "turn/input/accepted",
        clientRequestId: CREQ_2,
        scope: turnScope(turnId ?? ""),
      }),
    ]);
  });

  // -- turn boundary / claim-if-idle -----------------------------------------

  it("claimIfIdle boundary opens and settles a turn only when input is pending", () => {
    const assembler = createAssembler();
    // Idle, no pending input: the fallback closer owns nothing.
    expect(
      assemble(assembler, {
        kind: "turn.boundary",
        status: "completed",
        claimIfIdle: true,
      }),
    ).toEqual([]);

    assemble(assembler, { kind: "input.accepted", clientRequestId: CREQ });
    const events = assemble(assembler, {
      kind: "turn.boundary",
      status: "completed",
      claimIfIdle: true,
    });
    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "turn/completed",
    ]);
  });

  it("a non-claiming boundary without an open turn settles nothing", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "input.accepted", clientRequestId: CREQ });
    expect(
      assemble(assembler, { kind: "turn.boundary", status: "completed" }),
    ).toEqual([]);
  });

  it("boundary carries error and providerCheckpointId onto turn/completed", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const events = assemble(assembler, {
      kind: "turn.boundary",
      status: "failed",
      error: { message: "boom" },
      providerCheckpointId: "ckpt-1",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "turn/completed",
        status: "failed",
        error: { message: "boom" },
        providerCheckpointId: "ckpt-1",
      }),
    ]);
    expect(assembler.getOpenTurnId(THREAD_ID)).toBeUndefined();
  });

  it("mints a fresh turn id for every turn (never reuses across boundaries)", () => {
    const assembler = createAssembler();
    const first = assemble(assembler, { kind: "turn.open" });
    assemble(assembler, { kind: "turn.boundary", status: "completed" });
    const second = assemble(assembler, { kind: "turn.open" });
    const turnIdOf = (event: ThreadEvent | undefined): string =>
      event !== undefined && "scope" in event && event.scope.kind === "turn"
        ? event.scope.turnId
        : "";
    expect(turnIdOf(first[0])).toMatch(/^as-test-t\d+$/);
    expect(turnIdOf(second[0])).toMatch(/^as-test-t\d+$/);
    expect(turnIdOf(first[0])).not.toBe(turnIdOf(second[0]));
  });

  // -- items: open/close pairing --------------------------------------------

  it("echoes started command fields onto the paired close", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const started = assemble(assembler, bashOpen("tc-1"));
    expect(started).toEqual([
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "commandExecution",
          command: "npm test",
          cwd: "/repo",
          status: "pending",
        }),
      }),
    ]);

    const closed = assemble(assembler, {
      kind: "item.close",
      key: { providerItemId: "tc-1" },
      status: "failed",
      exitCode: 1,
      aggregatedOutput: "tests failed",
      // Fallback classification is present but the opened item's fields win.
      item: { type: "command", command: "", cwd: "" },
    });
    expect(closed).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          command: "npm test",
          cwd: "/repo",
          aggregatedOutput: "tests failed",
          exitCode: 1,
          status: "failed",
        }),
      }),
    ]);
    const startedItem =
      started[0]?.type === "item/started" ? started[0].item : undefined;
    const closedItem =
      closed[0]?.type === "item/completed" ? closed[0].item : undefined;
    expect(closedItem?.id).toBe(startedItem?.id);
  });

  it("builds the bare completed item on close-without-open", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const events = assemble(assembler, {
      kind: "item.close",
      key: { providerItemId: "tc-late" },
      status: "completed",
      exitCode: 0,
      aggregatedOutput: "late output",
      item: { type: "command", command: "", cwd: "" },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          command: "",
          cwd: "",
          aggregatedOutput: "late output",
          status: "completed",
        }),
      }),
    ]);
  });

  it("falls back to an unknown toolCall when a close has no classification", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const events = assemble(assembler, {
      kind: "item.close",
      key: { providerItemId: "tc-x" },
      status: "completed",
      resultText: "output",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "toolCall",
          tool: "unknown",
          result: "output",
          status: "completed",
        }),
      }),
    ]);
  });

  it("clears pairing state at the turn boundary so late closes get bare items", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" }, bashOpen("tc-1"));
    assemble(assembler, { kind: "turn.boundary", status: "completed" });
    assemble(assembler, { kind: "turn.open" });
    const events = assemble(assembler, {
      kind: "item.close",
      key: { providerItemId: "tc-1" },
      status: "completed",
      aggregatedOutput: "late output",
      item: { type: "command", command: "", cwd: "" },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          command: "",
          cwd: "",
          aggregatedOutput: "late output",
        }),
      }),
    ]);
  });

  it("builds file-change items with diffs and echoes changes onto the close", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const started = assemble(assembler, {
      kind: "item.open",
      key: { providerItemId: "tc-edit" },
      item: {
        type: "fileChange",
        path: "src/app.ts",
        oldText: "const enabled = false;\n",
        newText: "const enabled = true;\n",
      },
    });
    expect(started[0]).toMatchObject({
      type: "item/started",
      item: {
        type: "fileChange",
        status: "pending",
        changes: [
          expect.objectContaining({
            path: "src/app.ts",
            kind: "update",
            diff: expect.stringContaining("const enabled = true;"),
          }),
        ],
      },
    });
    const closed = assemble(assembler, {
      kind: "item.close",
      key: { providerItemId: "tc-edit" },
      status: "completed",
    });
    expect(closed[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        status: "completed",
        changes: [expect.objectContaining({ path: "src/app.ts" })],
      },
    });
  });

  it("maps parentRef through the provider→bb id map for nested items", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const parentStarted = assemble(assembler, {
      kind: "item.open",
      key: { providerItemId: "agent-parent-1" },
      item: { type: "tool", tool: "task", args: {} },
    });
    const parentBbId =
      parentStarted[0]?.type === "item/started"
        ? parentStarted[0].item.id
        : "";
    const childStarted = assemble(assembler, {
      kind: "item.open",
      key: { providerItemId: "tc-child", parentRef: "agent-parent-1" },
      item: { type: "command", command: "ls", cwd: "/repo" },
    });
    expect(childStarted[0]).toMatchObject({
      type: "item/started",
      item: { parentToolCallId: parentBbId },
    });
    // An unknown parent ref survives as-is rather than being dropped.
    const orphan = assemble(assembler, {
      kind: "item.open",
      key: { providerItemId: "tc-orphan", parentRef: "never-seen" },
      item: { type: "command", command: "ls", cwd: "/repo" },
    });
    expect(orphan[0]).toMatchObject({
      item: { parentToolCallId: "never-seen" },
    });
  });

  // -- message streams -------------------------------------------------------

  it("synthesizes item/started on a delta-first assistant stream and keeps the id stable", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const first = assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "Hel",
    });
    expect(first.map((event) => event.type)).toEqual([
      "item/started",
      "item/agentMessage/delta",
    ]);
    const itemId = first[0]?.type === "item/started" ? first[0].item.id : "";
    expect(itemId).toMatch(/^as-test-i\d+$/);

    const second = assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "lo",
    });
    expect(second).toEqual([
      expect.objectContaining({ type: "item/agentMessage/delta", itemId }),
    ]);
  });

  it("prefers provider-final text on close over the accumulated stream", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const first = assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "partial",
    });
    const itemId = first[0]?.type === "item/started" ? first[0].item.id : "";
    const closed = assemble(assembler, {
      kind: "message.close",
      channel: "assistant",
      streamKey: "assistant",
      text: "the full final text",
    });
    expect(closed).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: { type: "agentMessage", id: itemId, text: "the full final text" },
      }),
    ]);
  });

  it("settles with the accumulated text when the close carries none", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "acc",
    });
    assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "umulated",
    });
    const closed = assemble(assembler, {
      kind: "message.close",
      channel: "assistant",
      streamKey: "assistant",
    });
    expect(closed).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          text: "accumulated",
        }),
      }),
    ]);
  });

  it("detach closes the stream silently and later text mints a fresh item", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const pre = assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "before tool",
    });
    const preId = pre[0]?.type === "item/started" ? pre[0].item.id : "";
    expect(
      assemble(assembler, {
        kind: "message.close",
        channel: "assistant",
        streamKey: "assistant",
        detach: true,
      }),
    ).toEqual([]);
    const post = assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "after tool",
    });
    const postId = post[0]?.type === "item/started" ? post[0].item.id : "";
    expect(postId).not.toBe(preId);
    // A provider-final close after a detach mints a fresh completed item.
    const closed = assemble(assembler, {
      kind: "message.close",
      channel: "assistant",
      streamKey: "assistant",
      text: "final",
    });
    expect(closed[0]).toMatchObject({
      type: "item/completed",
      item: { type: "agentMessage", id: postId, text: "final" },
    });
  });

  it("a tool item.open detaches the open assistant stream in the same scope", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const pre = assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "before",
    });
    const preId = pre[0]?.type === "item/started" ? pre[0].item.id : "";
    assemble(assembler, bashOpen("tc-1"));
    const post = assemble(assembler, {
      kind: "message.delta",
      channel: "assistant",
      streamKey: "assistant",
      text: "after",
    });
    expect(post.map((event) => event.type)).toEqual([
      "item/started",
      "item/agentMessage/delta",
    ]);
    const postId = post[0]?.type === "item/started" ? post[0].item.id : "";
    expect(postId).not.toBe(preId);
  });

  it("keys reasoning streams independently and settles them as reasoning items", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const delta = assemble(assembler, {
      kind: "message.delta",
      channel: "reasoning",
      streamKey: "0",
      text: "Thinking.",
    });
    expect(delta.map((event) => event.type)).toEqual([
      "item/started",
      "item/reasoning/textDelta",
    ]);
    const itemId = delta[0]?.type === "item/started" ? delta[0].item.id : "";
    const closed = assemble(assembler, {
      kind: "message.close",
      channel: "reasoning",
      streamKey: "0",
      text: "Thinking.",
    });
    expect(closed).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: {
          type: "reasoning",
          id: itemId,
          summary: [],
          content: ["Thinking."],
        },
      }),
    ]);
  });

  // -- command output snapshots ----------------------------------------------

  it("diffs cumulative snapshots into append deltas and resets", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" }, bashOpen("tc-1"));
    const first = assemble(assembler, {
      kind: "command.outputSnapshot",
      key: { providerItemId: "tc-1" },
      text: "FIRST\n",
    });
    expect(first).toEqual([
      expect.objectContaining({
        type: "item/commandExecution/outputDelta",
        delta: "FIRST\n",
      }),
    ]);
    // Identical snapshot: nothing new.
    expect(
      assemble(assembler, {
        kind: "command.outputSnapshot",
        key: { providerItemId: "tc-1" },
        text: "FIRST\n",
      }),
    ).toEqual([]);
    const appended = assemble(assembler, {
      kind: "command.outputSnapshot",
      key: { providerItemId: "tc-1" },
      text: "FIRST\nSECOND\n",
    });
    expect(appended).toEqual([
      expect.objectContaining({ delta: "SECOND\n" }),
    ]);
    const reset = assemble(assembler, {
      kind: "command.outputSnapshot",
      key: { providerItemId: "tc-1" },
      text: "RESET\n",
    });
    expect(reset).toEqual([
      expect.objectContaining({ delta: "RESET\n", reset: true }),
    ]);
  });

  it("addresses output deltas by the minted bb item id", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const started = assemble(assembler, bashOpen("tc-1"));
    const bbItemId =
      started[0]?.type === "item/started" ? started[0].item.id : "";
    const events = assemble(assembler, {
      kind: "command.outputSnapshot",
      key: { providerItemId: "tc-1" },
      text: "OUT\n",
    });
    expect(events).toEqual([
      expect.objectContaining({ itemId: bbItemId, delta: "OUT\n" }),
    ]);
    expect(assembler.getBbItemId(THREAD_ID, "tc-1")).toBe(bbItemId);
    expect(assembler.getProviderItemId(THREAD_ID, bbItemId)).toBe("tc-1");
  });

  it("drops snapshots for items it never saw open", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    expect(
      assemble(assembler, {
        kind: "command.outputSnapshot",
        key: { providerItemId: "tc-unknown" },
        text: "OUT\n",
      }),
    ).toEqual([]);
  });

  it("clears snapshot history across turns so a repeat emits in full", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" }, bashOpen("tc-1"), {
      kind: "command.outputSnapshot",
      key: { providerItemId: "tc-1" },
      text: "FIRST\n",
    });
    assemble(assembler, { kind: "turn.boundary", status: "completed" });
    assemble(assembler, { kind: "turn.open" }, bashOpen("tc-1"));
    const events = assemble(assembler, {
      kind: "command.outputSnapshot",
      key: { providerItemId: "tc-1" },
      text: "FIRST\nSECOND\n",
    });
    expect(events).toEqual([
      expect.objectContaining({ delta: "FIRST\nSECOND\n" }),
    ]);
  });

  // -- usage / context window ------------------------------------------------

  it("accumulates usage into running thread totals across turns", () => {
    const assembler = createAssembler();
    const tokens = {
      totalTokens: 7736,
      inputTokens: 4200,
      cachedInputTokens: 3380,
      outputTokens: 156,
      reasoningOutputTokens: 0,
    };
    assemble(assembler, { kind: "turn.open" });
    const first = assemble(assembler, {
      kind: "usage.turn",
      tokens,
      modelContextWindow: 123_456,
    });
    assemble(assembler, { kind: "turn.boundary", status: "completed" });
    assemble(assembler, { kind: "turn.open" });
    const second = assemble(assembler, {
      kind: "usage.turn",
      tokens,
      modelContextWindow: 123_456,
    });
    expect(first[0]).toMatchObject({
      type: "thread/tokenUsage/updated",
      tokenUsage: { last: tokens, total: tokens, modelContextWindow: 123_456 },
    });
    expect(second[0]).toMatchObject({
      tokenUsage: {
        last: tokens,
        total: {
          totalTokens: 15_472,
          inputTokens: 8400,
          cachedInputTokens: 6760,
          outputTokens: 312,
        },
      },
    });
  });

  it("attaches currentOrLast context-window updates to the turn that just closed", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const turnId = assembler.getOpenTurnId(THREAD_ID) ?? "";
    assemble(assembler, { kind: "turn.boundary", status: "completed" });
    const events = assemble(assembler, {
      kind: "contextWindow",
      used: 54_321,
      size: 123_456,
      estimated: true,
      attach: "currentOrLast",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "thread/contextWindowUsage/updated",
        scope: turnScope(turnId),
        contextWindowUsage: {
          usedTokens: 54_321,
          modelContextWindow: 123_456,
          estimated: true,
        },
      }),
    ]);
  });

  it("falls back to thread scope when no turn ever opened for a context-window update", () => {
    const assembler = createAssembler();
    const events = assemble(assembler, {
      kind: "contextWindow",
      used: 10,
      estimated: true,
      attach: "currentOrLast",
    });
    expect(events).toEqual([
      expect.objectContaining({ scope: threadScope() }),
    ]);
  });

  it("scopes context.compacted to the current-or-last turn and drops it with none", () => {
    const assembler = createAssembler();
    expect(assemble(assembler, { kind: "context.compacted" })).toEqual([]);
    assemble(assembler, { kind: "turn.open" });
    const turnId = assembler.getOpenTurnId(THREAD_ID) ?? "";
    assemble(assembler, { kind: "turn.boundary", status: "completed" });
    expect(assemble(assembler, { kind: "context.compacted" })).toEqual([
      expect.objectContaining({
        type: "thread/compacted",
        scope: turnScope(turnId),
      }),
    ]);
  });

  // -- errors / unhandled ----------------------------------------------------

  it("a settling error fails the open turn after the error event", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const turnId = assembler.getOpenTurnId(THREAD_ID) ?? "";
    const events = assemble(assembler, {
      kind: "provider.error",
      message: "Provider error",
      detail: "quota exhausted",
      settlesTurn: true,
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/error",
        scope: turnScope(turnId),
        message: "Provider error",
        detail: "quota exhausted",
      }),
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(turnId),
        status: "failed",
      }),
    ]);
    expect(assembler.getOpenTurnId(THREAD_ID)).toBeUndefined();
  });

  it("a settling error claims a turn through pending accepted input", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "input.accepted", clientRequestId: CREQ });
    const events = assemble(assembler, {
      kind: "provider.error",
      message: "Provider error",
      settlesTurn: true,
    });
    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "provider/error",
      "turn/completed",
    ]);
  });

  it("an idle settling error stays a thread-scoped diagnostic and fabricates no turn", () => {
    const assembler = createAssembler();
    const events = assemble(assembler, {
      kind: "provider.error",
      message: "Provider error",
      settlesTurn: true,
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/error",
        scope: threadScope(),
      }),
    ]);
  });

  it("a retry error keeps the turn open", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const events = assemble(assembler, {
      kind: "provider.error",
      message: "Provider error",
      detail: "temporary failure",
      willRetry: true,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: "provider/error", willRetry: true }),
    ]);
    expect(assembler.getOpenTurnId(THREAD_ID)).toBeDefined();
  });

  it("scopes unhandled events to the open turn only when vouched", () => {
    const assembler = createAssembler();
    const raw = {
      jsonrpc: "2.0" as const,
      method: "sdk/message",
      params: { future: true },
    };
    assemble(assembler, { kind: "turn.open" });
    const turnId = assembler.getOpenTurnId(THREAD_ID) ?? "";
    const vouched = assemble(assembler, {
      kind: "unhandled",
      raw,
      rawType: "sdk/unknown",
      vouchedTurn: true,
    });
    expect(vouched).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "pi",
        rawType: "sdk/unknown",
        rawEvent: raw,
        scope: turnScope(turnId),
      }),
    ]);
    const unvouched = assemble(assembler, {
      kind: "unhandled",
      raw,
      rawType: "sdk/unknown",
      vouchedTurn: false,
    });
    expect(unvouched).toEqual([
      expect.objectContaining({ scope: threadScope() }),
    ]);
    assemble(assembler, { kind: "turn.boundary", status: "completed" });
    const late = assemble(assembler, {
      kind: "unhandled",
      raw,
      rawType: "sdk/unknown",
      vouchedTurn: true,
    });
    expect(late).toEqual([
      expect.objectContaining({ scope: threadScope() }),
    ]);
  });

  // -- turnless item/stream deltas --------------------------------------------

  it("never fabricates a turn for turnless item deltas: fallback surfaces, no fallback drops", () => {
    const assembler = createAssembler();
    const raw = {
      jsonrpc: "2.0" as const,
      method: "sdk/message",
      params: { message: { type: "tool_execution_start" } },
    };
    const surfaced = assemble(assembler, {
      kind: "item.open",
      key: { providerItemId: "tc-1" },
      item: { type: "command", command: "npm test", cwd: "/repo" },
      noTurnFallback: { raw, rawType: "sdk/tool_execution_start" },
    });
    expect(surfaced).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "pi",
        rawType: "sdk/tool_execution_start",
        rawEvent: raw,
        scope: threadScope(),
      }),
    ]);
    // No fallback attached: the turnless delta drops silently.
    expect(
      assemble(assembler, {
        kind: "message.delta",
        channel: "assistant",
        streamKey: "assistant",
        text: "orphan",
      }),
    ).toEqual([]);
    expect(assembler.getOpenTurnId(THREAD_ID)).toBeUndefined();
  });

  it("turnless item deltas do not claim pending accepted input", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "input.accepted", clientRequestId: CREQ });
    expect(
      assemble(assembler, {
        kind: "item.close",
        key: { providerItemId: "tc-1" },
        status: "completed",
      }),
    ).toEqual([]);
    // The claim still belongs to the lifecycle closer.
    const events = assemble(assembler, {
      kind: "turn.boundary",
      status: "completed",
      claimIfIdle: true,
    });
    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "turn/completed",
    ]);
  });

  // -- session settlement ----------------------------------------------------

  it("session.ended interrupts the open turn and its open items", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" }, bashOpen("tc-1"));
    const turnId = assembler.getOpenTurnId(THREAD_ID) ?? "";
    const events = assemble(assembler, {
      kind: "session.ended",
      reason: "interrupted",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          command: "npm test",
          status: "interrupted",
        }),
      }),
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(turnId),
        status: "interrupted",
      }),
    ]);
    expect(assembler.getOpenTurnId(THREAD_ID)).toBeUndefined();
  });

  it("session.ended with an error fails the turn and surfaces the error first", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "turn.open" });
    const events = assemble(assembler, {
      kind: "session.ended",
      reason: "exited",
      error: { message: "child died" },
    });
    expect(events.map((event) => event.type)).toEqual([
      "provider/error",
      "turn/completed",
    ]);
    expect(events[1]).toMatchObject({
      status: "failed",
      error: { message: "child died" },
    });
  });

  it("session.ended on an idle thread with no pending input settles nothing", () => {
    const assembler = createAssembler();
    expect(
      assemble(assembler, { kind: "session.ended", reason: "interrupted" }),
    ).toEqual([]);
  });

  it("session.ended claims and settles a turn owed to pending accepted input", () => {
    const assembler = createAssembler();
    assemble(assembler, { kind: "input.accepted", clientRequestId: CREQ });
    const events = assemble(assembler, {
      kind: "session.ended",
      reason: "interrupted",
    });
    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "turn/completed",
    ]);
  });

  // -- id discipline ---------------------------------------------------------

  it("keeps threads isolated and ids unique across threads", () => {
    const assembler = createAssembler();
    const a = assembler.assemble({
      threadId: "thr_a",
      deltas: [{ kind: "turn.open" }],
    });
    const b = assembler.assemble({
      threadId: "thr_b",
      deltas: [{ kind: "turn.open" }],
    });
    const turnIdOf = (event: ThreadEvent | undefined): string =>
      event !== undefined && "scope" in event && event.scope.kind === "turn"
        ? event.scope.turnId
        : "";
    expect(turnIdOf(a[0])).not.toBe(turnIdOf(b[0]));
    expect(assembler.getOpenTurnId("thr_a")).toBe(turnIdOf(a[0]));
    expect(assembler.getOpenTurnId("thr_b")).toBe(turnIdOf(b[0]));
  });
});

describe("diffCumulativeText", () => {
  it("returns the full text on the first snapshot", () => {
    expect(diffCumulativeText({ nextText: "A\n" })).toEqual({
      delta: "A\n",
      nextText: "A\n",
      reset: false,
    });
  });

  it("returns only the appended suffix", () => {
    expect(
      diffCumulativeText({ previousText: "A\n", nextText: "A\nB\n" }),
    ).toEqual({ delta: "B\n", nextText: "A\nB\n", reset: false });
  });

  it("returns null for identical or empty snapshots", () => {
    expect(diffCumulativeText({ previousText: "A\n", nextText: "A\n" })).toBe(
      null,
    );
    expect(diffCumulativeText({ previousText: "A\n", nextText: "" })).toBe(
      null,
    );
  });

  it("flags a reset when the snapshot restarted", () => {
    expect(
      diffCumulativeText({ previousText: "A\nB\n", nextText: "C\n" }),
    ).toEqual({ delta: "C\n", nextText: "C\n", reset: true });
  });
});
