import { describe, expect, it } from "vitest";
import type {
  TimelineConversationRow,
  TimelineRow,
  TimelineTurnRow,
} from "@bb/server-contract";
import {
  FORK_CONTEXT_WINDOW_SIZE,
  SIDE_CHAT_CONTEXT_WINDOW_SIZE,
  buildConversationContextSnapshot,
  type ConversationContextScope,
} from "./conversation-context-snapshot";

let nextSeq = 0;

function conversationRow(
  role: TimelineConversationRow["role"],
  text: string,
): TimelineConversationRow {
  const seq = (nextSeq += 1);
  const base = {
    id: `row_${seq}`,
    threadId: "thr_main",
    turnId: "turn_1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    kind: "conversation" as const,
    text,
    attachments: null,
  };
  if (role === "user") {
    return {
      ...base,
      role: "user",
      initiator: "user",
      senderThreadId: null,
      turnRequest: { kind: "message", status: "accepted" },
      mentions: [],
    };
  }
  return { ...base, role: "assistant", turnRequest: null };
}

function turnRow(children: TimelineRow[]): TimelineTurnRow {
  const seq = (nextSeq += 1);
  return {
    id: `turn_row_${seq}`,
    threadId: "thr_main",
    turnId: `turn_${seq}`,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    kind: "turn",
    status: "completed",
    summaryCount: 0,
    completedAt: seq,
    children,
  };
}

function snapshotText(args: {
  rows: readonly TimelineRow[];
  sourceMessageText: string;
  scope: ConversationContextScope;
}): string {
  const parts = buildConversationContextSnapshot({
    parentThreadId: "thr_main",
    ...args,
  });
  expect(parts).toHaveLength(1);
  const [part] = parts;
  expect(part?.type).toBe("text");
  expect(part?.visibility).toBe("agent-only");
  return part?.type === "text" ? part.text : "";
}

describe("buildConversationContextSnapshot", () => {
  it("returns an empty snapshot when there are no conversation rows", () => {
    expect(
      buildConversationContextSnapshot({
        rows: [],
        sourceMessageText: "anything",
        parentThreadId: "thr_main",
        scope: "side-chat",
      }),
    ).toEqual([]);
  });

  it("points the agent at the full parent thread via bb thread show", () => {
    const rows = [
      conversationRow("user", "u1"),
      conversationRow("assistant", "anchor"),
    ];
    const text = snapshotText({
      rows,
      sourceMessageText: "anchor",
      scope: "side-chat",
    });
    expect(text).toContain("bb thread show thr_main");
    expect(text).toContain("2 messages total");
  });

  it("flattens conversation rows nested inside turn rows", () => {
    const rows = [
      turnRow([
        conversationRow("user", "nested question"),
        conversationRow("assistant", "nested answer"),
      ]),
    ];
    const text = snapshotText({
      rows,
      sourceMessageText: "nested answer",
      scope: "side-chat",
    });
    expect(text).toContain("User: nested question");
    expect(text).toContain("Assistant: nested answer");
  });

  it("uses a wider default window for forks than side chats", () => {
    expect(FORK_CONTEXT_WINDOW_SIZE).toBeGreaterThan(
      SIDE_CHAT_CONTEXT_WINDOW_SIZE,
    );
  });

  describe("side-chat scope", () => {
    it("includes the anchor + preceding window + tail, but drops messages older than the window", () => {
      const rows: TimelineRow[] = [];
      // (window + 2) messages precede the anchor, so the two oldest fall outside.
      for (let i = 0; i < SIDE_CHAT_CONTEXT_WINDOW_SIZE + 2; i += 1) {
        rows.push(conversationRow("user", `pre-${i}`));
      }
      rows.push(conversationRow("assistant", "anchor"));
      rows.push(conversationRow("user", "after-user"));
      const text = snapshotText({
        rows,
        sourceMessageText: "anchor",
        scope: "side-chat",
      });
      expect(text).toContain("Assistant: anchor"); // anchor itself
      expect(text).toContain("User: after-user"); // captured tail
      expect(text).toContain(`User: pre-${SIDE_CHAT_CONTEXT_WINDOW_SIZE - 1}`); // newest within window
      expect(text).not.toContain("User: pre-0"); // oldest, beyond the window
    });
  });

  describe("fork scope", () => {
    it("includes the lead-up within the window but not the anchor, the tail, or pre-window messages", () => {
      const rows: TimelineRow[] = [];
      for (let i = 0; i < FORK_CONTEXT_WINDOW_SIZE + 2; i += 1) {
        rows.push(conversationRow("user", `pre-${i}`));
      }
      rows.push(conversationRow("assistant", "anchor"));
      rows.push(conversationRow("user", "after-user"));
      const text = snapshotText({
        rows,
        sourceMessageText: "anchor",
        scope: "fork",
      });
      expect(text).toContain(`User: pre-${FORK_CONTEXT_WINDOW_SIZE - 1}`); // lead-up within window
      expect(text).not.toContain("Assistant: anchor"); // anchor is the visible seed
      expect(text).not.toContain("User: after-user"); // nothing after the anchor
      expect(text).not.toContain("User: pre-0"); // oldest, beyond the window
    });

    it("still emits the parent pointer when the anchor is the first message (no lead-up)", () => {
      const rows = [
        conversationRow("assistant", "anchor"),
        conversationRow("user", "after"),
      ];
      const text = snapshotText({
        rows,
        sourceMessageText: "anchor",
        scope: "fork",
      });
      expect(text).toContain("bb thread show thr_main");
      expect(text).not.toContain("Assistant: anchor");
    });
  });
});
