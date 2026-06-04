import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import { deriveStoredEventItemFields } from "../src/stored-event-item-fields.js";

describe("deriveStoredEventItemFields", () => {
  it("derives item columns from started item events", () => {
    expect(
      deriveStoredEventItemFields({
        type: "item/started",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        item: {
          id: "tool-1",
          type: "toolCall",
          tool: "read_file",
          status: "pending",
        },
      }),
    ).toEqual({
      itemId: "tool-1",
      itemKind: "toolCall",
    });
  });

  it("derives item columns from completed item events", () => {
    expect(
      deriveStoredEventItemFields({
        type: "item/completed",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        item: {
          id: "msg-1",
          type: "agentMessage",
          text: "hello",
        },
      }),
    ).toEqual({
      itemId: "msg-1",
      itemKind: "agentMessage",
    });
  });

  it("derives item columns from backgroundTask lifecycle events", () => {
    const item = {
      id: "task:wf-1",
      type: "backgroundTask",
      taskType: "local_workflow",
      description: "fixture workflow",
      status: "pending",
      taskStatus: "running",
      skipTranscript: false,
    } as const;

    expect(
      deriveStoredEventItemFields({
        type: "item/backgroundTask/progress",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        scope: threadScope(),
        item,
      }),
    ).toEqual({
      itemId: "task:wf-1",
      itemKind: "backgroundTask",
    });

    expect(
      deriveStoredEventItemFields({
        type: "item/backgroundTask/completed",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        scope: threadScope(),
        item: { ...item, status: "completed", taskStatus: "completed" },
      }),
    ).toEqual({
      itemId: "task:wf-1",
      itemKind: "backgroundTask",
    });
  });

  it("derives item ids from delta and progress events without an item kind", () => {
    expect(
      deriveStoredEventItemFields({
        type: "item/toolCall/progress",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        itemId: "tool-1",
        message: "still running",
      }),
    ).toEqual({
      itemId: "tool-1",
      itemKind: null,
    });
  });

  it("derives item ids from agent-message delta events", () => {
    expect(
      deriveStoredEventItemFields({
        type: "item/agentMessage/delta",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        itemId: "msg-1",
        delta: "hel",
      }),
    ).toEqual({
      itemId: "msg-1",
      itemKind: null,
    });
  });

  it("returns null item columns for non-item events", () => {
    expect(
      deriveStoredEventItemFields({
        type: "system/error",
        threadId: "thread-1",
        scope: threadScope(),
        code: "tool_failed",
        message: "Something failed",
      }),
    ).toEqual({
      itemId: null,
      itemKind: null,
    });
  });
});
