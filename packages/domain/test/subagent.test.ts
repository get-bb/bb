import { describe, expect, it } from "vitest";
import {
  threadSubagentCancelResultSchema,
  threadSubagentMessageResultSchema,
  threadSubagentSchema,
} from "../src/subagent.js";

describe("provider-neutral subagents", () => {
  it("preserves identity, lifecycle, progress, and Unicode results", () => {
    expect(
      threadSubagentSchema.parse({
        childRef: "child-1",
        parentToolCallId: "call-1",
        label: "CHILD_ALPHA 😀",
        subagentType: "general-purpose",
        model: "grok-test",
        status: "running",
        progress: {
          durationMs: 20,
          turnCount: 2,
          toolCallCount: 1,
          tokensUsed: 100,
        },
      }),
    ).toMatchObject({ childRef: "child-1", status: "running" });
    expect(
      threadSubagentSchema.parse({
        childRef: "child-1",
        parentToolCallId: "call-1",
        label: "CHILD_ALPHA",
        subagentType: "general-purpose",
        status: "completed",
        result: "Результат مراجعة 😀",
      }),
    ).toMatchObject({ result: "Результат مراجعة 😀" });
  });

  it("rejects missing identity and unknown lifecycle states", () => {
    expect(() =>
      threadSubagentSchema.parse({
        childRef: "",
        parentToolCallId: "call-1",
        label: "child",
        subagentType: "general-purpose",
        status: "running",
      }),
    ).toThrow();
    expect(() =>
      threadSubagentSchema.parse({
        childRef: "child-1",
        parentToolCallId: "call-1",
        label: "child",
        subagentType: "general-purpose",
        status: "killed",
      }),
    ).toThrow(/status|expected/i);
  });

  it("validates message and cancellation results without raw provider fields", () => {
    expect(
      threadSubagentMessageResultSchema.parse({
        childRef: "child-1",
        messageId: "message-1",
      }),
    ).toEqual({ childRef: "child-1", messageId: "message-1" });
    expect(
      threadSubagentCancelResultSchema.parse({
        childRef: "child-1",
        status: "cancelled",
      }),
    ).toEqual({ childRef: "child-1", status: "cancelled" });
  });
});
