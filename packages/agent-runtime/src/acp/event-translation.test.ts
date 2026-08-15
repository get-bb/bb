import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import type { ProviderRuntimeEvent } from "../runtime-json-rpc.js";
import {
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
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
