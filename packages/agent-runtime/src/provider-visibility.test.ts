import { describe, expect, it } from "vitest";
import { claudeCodeVisibilityMetadata } from "./claude-code/visibility.js";
import { codexVisibilityMetadata } from "./codex/visibility.js";
import { piVisibilityMetadata } from "./pi/visibility.js";
import type { JsonRpcMessage } from "./runtime-json-rpc.js";

describe("provider visibility raw events", () => {
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
      piVisibilityMetadata.describeRawEvent({
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

    expect(
      piVisibilityMetadata.describeRawEvent({
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

  it("classifies Codex MCP startup status updates as noise", () => {
    expect(
      codexVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "mcpServer/startupStatus/updated",
        params: {
          name: "codex_apps",
          status: "failed",
          error: "MCP client failed to start",
        },
      }),
    ).toEqual({
      kind: "mcpServer/startupStatus/updated",
      coverage: "noise",
    });

    expect(
      codexVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "mcpServer/startupStatus/updated",
        params: {
          name: "codex_apps",
          status: "ready",
          error: null,
        },
      }),
    ).toEqual({
      kind: "mcpServer/startupStatus/updated",
      coverage: "noise",
    });
  });

  it("classifies Codex turn moderation metadata as noise", () => {
    expect(
      codexVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "turn/moderationMetadata",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          metadata: {
            prompt: {},
            generation: {},
            tool_call: {},
            tool_response: {},
          },
        },
      }),
    ).toEqual({
      kind: "turn/moderationMetadata",
      coverage: "noise",
    });
  });

  it("classifies Codex raw response completions as noise", () => {
    expect(
      codexVisibilityMetadata.describeRawEvent({
        jsonrpc: "2.0",
        method: "rawResponse/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          responseId: "response-1",
          usage: {
            totalTokens: 19_206,
            inputTokens: 18_971,
            cachedInputTokens: 11_008,
            cacheWriteInputTokens: 0,
            outputTokens: 235,
            reasoningOutputTokens: 53,
          },
        },
      }),
    ).toEqual({
      kind: "rawResponse/completed",
      coverage: "noise",
    });
  });
});
