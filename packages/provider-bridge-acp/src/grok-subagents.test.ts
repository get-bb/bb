import { describe, expect, it } from "vitest";
import {
  buildGrokSubagentActionPrompt,
  decodeGrokSpawnToolResult,
  decodeGrokSubagentActionResult,
  decodeGrokSubagentNotification,
} from "./grok-subagents.js";

const spawned = {
  sessionUpdate: "subagent_spawned",
  subagent_id: "child-1",
  attempt_id: "attempt-1",
  parent_session_id: "parent-1",
  parent_prompt_id: "prompt-1",
  child_session_id: "child-session-1",
  subagent_type: "general-purpose",
  description: "CHILD_ALPHA",
  model: "grok-test",
  future: true,
};

describe("Grok subagent adapter", () => {
  it("decodes stable spawn, progress, and finish identities with future fields", () => {
    expect(decodeGrokSubagentNotification(spawned)).toEqual({
      kind: "spawned",
      subagentId: "child-1",
      parentSessionId: "parent-1",
      childSessionId: "child-session-1",
      description: "CHILD_ALPHA",
      subagentType: "general-purpose",
      model: "grok-test",
    });
    expect(
      decodeGrokSubagentNotification({
        sessionUpdate: "subagent_progress",
        subagent_id: "child-1",
        duration_ms: 20,
        turn_count: 2,
        tool_call_count: 1,
        tokens_used: 100,
        future: true,
      }),
    ).toEqual({
      kind: "progress",
      subagentId: "child-1",
      durationMs: 20,
      turnCount: 2,
      toolCallCount: 1,
      tokensUsed: 100,
    });
    expect(
      decodeGrokSubagentNotification({
        sessionUpdate: "subagent_finished",
        subagent_id: "child-1",
        status: "cancelled",
        error: "Subagent was cancelled",
        will_wake: false,
      }),
    ).toEqual({
      kind: "finished",
      subagentId: "child-1",
      status: "cancelled",
      output: undefined,
      error: "Subagent was cancelled",
    });
  });

  it("extracts the child identity from the real spawn tool text", () => {
    expect(
      decodeGrokSpawnToolResult({
        type: "Text",
        text: "Subagent started in background.\nsubagent_id: child-1\ndescription: CHILD_ALPHA",
      }),
    ).toBe("child-1");
  });

  it("decodes only accepted message and killed cancellation outcomes", () => {
    expect(
      decodeGrokSubagentActionResult("send_subagent_message", {
        type: "SendSubagentMessage",
        outcome: "accepted",
        message_id: "message-1",
      }),
    ).toEqual({ kind: "message", messageId: "message-1" });
    expect(
      decodeGrokSubagentActionResult("kill_command_or_subagent", {
        type: "KillTask",
        Result: {
          task_id: "child-1",
          outcome: "killed",
          message: "Subagent cancellation initiated",
        },
      }),
    ).toEqual({ kind: "cancel", childRef: "child-1" });
  });

  it("rejects malformed identities, notifications, and action results", () => {
    expect(() =>
      decodeGrokSpawnToolResult({ type: "Text", text: "no id" }),
    ).toThrow(/subagent_id/i);
    expect(() =>
      decodeGrokSubagentNotification({ ...spawned, description: "  " }),
    ).toThrow(/description/i);
    expect(() =>
      decodeGrokSubagentActionResult("send_subagent_message", {
        type: "SendSubagentMessage",
        outcome: "accepted",
      }),
    ).toThrow(/message_id/i);
    expect(() =>
      decodeGrokSubagentActionResult("kill_command_or_subagent", {
        type: "KillTask",
        Result: { task_id: "child-1", outcome: "failed" },
      }),
    ).toThrow(/outcome|killed/i);
  });

  it("builds exact parent-mediated message and cancel prompts with Unicode", () => {
    const text = "CHILD_MESSAGE 😀 مراجعة\nSecond line";
    expect(
      buildGrokSubagentActionPrompt({
        kind: "tell",
        childRef: "child-1",
        text,
      }),
    ).toContain('subagent_id="child-1"');
    expect(
      buildGrokSubagentActionPrompt({
        kind: "tell",
        childRef: "child-1",
        text,
      }),
    ).toContain(JSON.stringify(text));
    expect(
      buildGrokSubagentActionPrompt({ kind: "cancel", childRef: "child-1" }),
    ).toContain('task_ids=["child-1"]');
  });

  it("rejects blank messages and preserves large text without a second quota", () => {
    expect(() =>
      buildGrokSubagentActionPrompt({
        kind: "tell",
        childRef: "c",
        text: "  ",
      }),
    ).toThrow(/blank/i);
    const text = "x".repeat(64_001);
    expect(
      buildGrokSubagentActionPrompt({ kind: "tell", childRef: "c", text }),
    ).toContain(text);
  });
});
