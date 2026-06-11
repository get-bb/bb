import { describe, expect, it } from "vitest";
import {
  decodeNativeProviderToolCallRequest,
  decodeNormalizedProviderToolCallRequest,
} from "./provider-tool-call-contract.js";

describe("provider-tool-call-contract", () => {
  it("preserves optional BB thread hints on normalized bridge tool calls", () => {
    expect(
      decodeNormalizedProviderToolCallRequest("req-1", "item/tool/call", {
        providerThreadId: "provider-abc",
        threadId: "thr_123",
        turnId: "turn-1",
        callId: "call-1",
        tool: "notify_user",
        arguments: { text: "hello" },
      }),
    ).toEqual({
      requestId: "req-1",
      threadId: "thr_123",
      providerThreadId: "provider-abc",
      turnId: "turn-1",
      callId: "call-1",
      tool: "notify_user",
      arguments: { text: "hello" },
    });
  });

  it("allows normalized bridge tool calls to omit a BB thread hint", () => {
    expect(
      decodeNormalizedProviderToolCallRequest("req-2", "item/tool/call", {
        providerThreadId: "provider-abc",
        turnId: "turn-1",
        callId: "call-1",
        tool: "notify_user",
        arguments: { text: "hello" },
      }),
    ).toEqual({
      requestId: "req-2",
      providerThreadId: "provider-abc",
      turnId: "turn-1",
      callId: "call-1",
      tool: "notify_user",
      arguments: { text: "hello" },
    });
  });

  it("normalizes canonical unresolved bridge tool call turn ids to null", () => {
    expect(
      decodeNormalizedProviderToolCallRequest("req-3", "item/tool/call", {
        providerThreadId: "provider-abc",
        turnId: null,
        callId: "call-1",
        tool: "notify_user",
        arguments: { text: "hello" },
      }),
    ).toEqual({
      requestId: "req-3",
      providerThreadId: "provider-abc",
      turnId: null,
      callId: "call-1",
      tool: "notify_user",
      arguments: { text: "hello" },
    });
  });

  it("rejects noncanonical unresolved bridge tool call turn ids", () => {
    expect(
      decodeNormalizedProviderToolCallRequest("req-4", "item/tool/call", {
        providerThreadId: "provider-abc",
        turnId: "",
        callId: "call-1",
        tool: "notify_user",
        arguments: { text: "hello" },
      }),
    ).toBeNull();

    expect(
      decodeNormalizedProviderToolCallRequest("req-5", "item/tool/call", {
        providerThreadId: "provider-abc",
        callId: "call-1",
        tool: "notify_user",
        arguments: { text: "hello" },
      }),
    ).toBeNull();
  });

  it("treats native provider tool calls as provider-scoped requests", () => {
    expect(
      decodeNativeProviderToolCallRequest("req-2", "item/tool/call", {
        threadId: "provider-abc",
        turnId: "turn-1",
        callId: "call-1",
        tool: "notify_user",
        arguments: { text: "hello" },
      }),
    ).toEqual({
      requestId: "req-2",
      providerThreadId: "provider-abc",
      turnId: "turn-1",
      callId: "call-1",
      tool: "notify_user",
      arguments: { text: "hello" },
    });
  });
});
