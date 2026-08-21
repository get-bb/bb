import { describe, expect, it } from "vitest";
import { claudeCodeVisibilityMetadata } from "./visibility.js";
import type { JsonRpcMessage } from "@bb/provider-bridge-protocol/bridge-kit";

describe("claude-code visibility raw events", () => {
  it("classifies shared handled non-sdk envelopes as normalized", () => {
    expect(
      claudeCodeVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "thread/contextWindowUsage/updated",
        params: {
          threadId: "t1",
          contextWindowUsage: {
            usedTokens: 12,
            modelContextWindow: 100,
            estimated: false,
          },
        },
      }),
    ).toEqual({
      kind: "thread/contextWindowUsage/updated",
      coverage: "normalized",
    });

    expect(
      claudeCodeVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "error",
        params: {
          message: "provider failed",
        },
      }),
    ).toEqual({
      kind: "error",
      coverage: "normalized",
    });
  });

  it("classifies Claude stream ping events as noise", () => {
    expect(
      claudeCodeVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "thread-1",
          message: {
            type: "stream_event",
            event: {
              type: "ping",
            },
            session_id: "session-1",
            parent_tool_use_id: null,
            uuid: "message-1",
          },
        },
      } satisfies JsonRpcMessage),
    ).toEqual({
      kind: "sdk/stream_event:ping",
      coverage: "noise",
    });
  });

  it("classifies Claude command lifecycle events as noise", () => {
    expect(
      claudeCodeVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "thread-1",
          message: {
            type: "command_lifecycle",
            command_uuid: "command-1",
            state: "started",
            uuid: "message-1",
            session_id: "session-1",
          },
        },
      } satisfies JsonRpcMessage),
    ).toEqual({
      kind: "sdk/command_lifecycle",
      coverage: "noise",
    });
  });

  it("classifies Claude conversation resets as normalized", () => {
    expect(
      claudeCodeVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "thread-1",
          message: {
            type: "conversation_reset",
            session_id: "session-1",
          },
        },
      } satisfies JsonRpcMessage),
    ).toEqual({
      kind: "sdk/conversation_reset",
      coverage: "normalized",
    });
  });

  it("classifies Claude thinking token system events as noise", () => {
    expect(
      claudeCodeVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "thread-1",
          message: {
            type: "system",
            subtype: "thinking_tokens",
            estimated_tokens: 24,
            estimated_tokens_delta: 23,
            uuid: "message-1",
            session_id: "session-1",
          },
        },
      } satisfies JsonRpcMessage),
    ).toEqual({
      kind: "sdk/system:thinking_tokens",
      coverage: "noise",
    });
  });
});
