import { describe, expect, it } from "vitest";
import type {
  TimelineConversationRow,
  TimelineRow,
  TimelineTurnRow,
} from "@bb/server-contract";
import {
  SIDE_CHAT_CONTEXT_WINDOW_SIZE,
  buildSideChatContextSnapshot,
} from "./side-chat-context-snapshot";

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

function snapshotText(rows: readonly TimelineRow[], sourceMessageText: string) {
  const parts = buildSideChatContextSnapshot({ rows, sourceMessageText });
  expect(parts).toHaveLength(1);
  const [part] = parts;
  expect(part?.type).toBe("text");
  expect(part?.visibility).toBe("agent-only");
  return part?.type === "text" ? part.text : "";
}

describe("buildSideChatContextSnapshot", () => {
  it("produces a single agent-only text part", () => {
    const rows = [
      conversationRow("user", "How do I add an index?"),
      conversationRow("assistant", "Add a CREATE INDEX migration."),
    ];
    const parts = buildSideChatContextSnapshot({
      rows,
      sourceMessageText: "Add a CREATE INDEX migration.",
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "text",
      visibility: "agent-only",
      mentions: [],
    });
  });

  it("returns an empty snapshot when there are no conversation rows", () => {
    expect(
      buildSideChatContextSnapshot({ rows: [], sourceMessageText: "anything" }),
    ).toEqual([]);
  });

  it("includes the anchor message and the preceding window", () => {
    const rows = [
      conversationRow("user", "u1"),
      conversationRow("assistant", "a1"),
      conversationRow("user", "u2"),
      conversationRow("assistant", "a2"),
      conversationRow("user", "u3"),
      conversationRow("assistant", "anchor"),
    ];
    const text = snapshotText(rows, "anchor");
    // windowSize=3 preceding messages + the anchor => last 4 messages.
    expect(text).toContain("Assistant: anchor");
    expect(text).toContain("User: u2");
    expect(text).toContain("Assistant: a2");
    expect(text).toContain("User: u3");
    expect(text).not.toContain("u1");
    expect(text).not.toContain("Assistant: a1");
  });

  it("respects the default window size constant", () => {
    expect(SIDE_CHAT_CONTEXT_WINDOW_SIZE).toBe(3);
  });

  it("flattens conversation rows nested inside turn rows", () => {
    const rows = [
      turnRow([
        conversationRow("user", "nested question"),
        conversationRow("assistant", "nested answer"),
      ]),
    ];
    const text = snapshotText(rows, "nested answer");
    expect(text).toContain("User: nested question");
    expect(text).toContain("Assistant: nested answer");
  });

  it("includes messages after the anchor in the captured tail", () => {
    const rows = [
      conversationRow("assistant", "anchor"),
      conversationRow("user", "follow-up after anchor"),
    ];
    const text = snapshotText(rows, "anchor");
    expect(text).toContain("Assistant: anchor");
    expect(text).toContain("User: follow-up after anchor");
  });

  it("falls back to the conversation tail when the anchor is not found", () => {
    const rows = [
      conversationRow("user", "u1"),
      conversationRow("assistant", "a1"),
      conversationRow("user", "u2"),
      conversationRow("assistant", "a2"),
    ];
    const text = snapshotText(rows, "no such message");
    // Anchor falls back to the last message; window of 3 preceding => all four.
    expect(text).toContain("User: u1");
    expect(text).toContain("Assistant: a2");
  });

  it("honors a custom window size", () => {
    const rows = [
      conversationRow("user", "u1"),
      conversationRow("assistant", "a1"),
      conversationRow("user", "u2"),
      conversationRow("assistant", "anchor"),
    ];
    const parts = buildSideChatContextSnapshot({
      rows,
      sourceMessageText: "anchor",
      windowSize: 1,
    });
    const text = parts[0]?.type === "text" ? parts[0].text : "";
    expect(text).toContain("User: u2");
    expect(text).toContain("Assistant: anchor");
    expect(text).not.toContain("u1");
    expect(text).not.toContain("Assistant: a1");
  });
});
