import { describe, expect, it } from "vitest";
import { threadEventSchema, turnScope } from "../src/index.js";

const CLIENT_REQUEST_ID = "creq_23456789ab";

describe("provider event schema", () => {
  it("uses clientRequestId for accepted input and user-message items", () => {
    expect(
      threadEventSchema.parse({
        type: "turn/input/accepted",
        threadId: "thr_123",
        providerThreadId: "provider-thread-123",
        clientRequestId: CLIENT_REQUEST_ID,
        scope: turnScope("turn_123"),
      }),
    ).toMatchObject({
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect(
      threadEventSchema.parse({
        type: "item/started",
        threadId: "thr_123",
        providerThreadId: "provider-thread-123",
        item: {
          type: "userMessage",
          id: "item_123",
          content: [{ type: "text", text: "hello" }],
          clientRequestId: CLIENT_REQUEST_ID,
        },
        scope: turnScope("turn_123"),
      }),
    ).toMatchObject({
      item: {
        clientRequestId: CLIENT_REQUEST_ID,
      },
    });
  });

  it("rejects old clientRequestSequence event shapes", () => {
    expect(() =>
      threadEventSchema.parse({
        type: "turn/input/accepted",
        threadId: "thr_123",
        providerThreadId: "provider-thread-123",
        clientRequestSequence: 1,
        scope: turnScope("turn_123"),
      }),
    ).toThrow();

    expect(() =>
      threadEventSchema.parse({
        type: "item/started",
        threadId: "thr_123",
        providerThreadId: "provider-thread-123",
        item: {
          type: "userMessage",
          id: "item_123",
          content: [{ type: "text", text: "hello" }],
          clientRequestSequence: 1,
        },
        scope: turnScope("turn_123"),
      }),
    ).toThrow();
  });

  it("allows provider turn starts to carry parent tool call ids", () => {
    expect(
      threadEventSchema.parse({
        type: "turn/started",
        threadId: "thr_child",
        providerThreadId: "provider-thread-123",
        parentToolCallId: "tool-call-123",
        scope: turnScope("turn_child"),
      }),
    ).toMatchObject({
      parentToolCallId: "tool-call-123",
    });
  });
});
