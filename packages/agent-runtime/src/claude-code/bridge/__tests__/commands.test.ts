import { describe, expect, it } from "vitest";
import { decodeClaudeCodeJsonRpcRequest } from "../commands.js";

const baseThreadStartParams = {
  threadId: "bb-thread-1",
  cwd: "/tmp/worktree",
  baseInstructions: "test",
  permissionMode: "default",
  permissionEscalation: "ask",
  instructionMode: "append",
  workflowsEnabled: false,
};

describe("decodeClaudeCodeJsonRpcRequest", () => {
  it("decodes thread/start with an explicit workflowsEnabled", () => {
    const decoded = decodeClaudeCodeJsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "thread/start",
      params: baseThreadStartParams,
    });
    expect(decoded).toMatchObject({
      method: "thread/start",
      params: { workflowsEnabled: false },
    });
  });

  it("decodes thread/start with a json_schema output format", () => {
    const outputFormat = {
      type: "json_schema",
      schema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      },
    };
    const decoded = decodeClaudeCodeJsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "thread/start",
      params: { ...baseThreadStartParams, outputFormat },
    });
    expect(decoded).toMatchObject({
      method: "thread/start",
      params: { outputFormat },
    });
  });

  it("rejects thread/start with a malformed output format", () => {
    expect(
      decodeClaudeCodeJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "thread/start",
        params: {
          ...baseThreadStartParams,
          outputFormat: { type: "text" },
        },
      }),
    ).toBeNull();
  });

  it("rejects session commands that omit workflowsEnabled (the policy is filled at the server boundary, never defaulted downstream)", () => {
    const { workflowsEnabled: _omitted, ...withoutWorkflowsEnabled } =
      baseThreadStartParams;
    expect(
      decodeClaudeCodeJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "thread/start",
        params: withoutWorkflowsEnabled,
      }),
    ).toBeNull();
    expect(
      decodeClaudeCodeJsonRpcRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "thread/resume",
        params: {
          ...withoutWorkflowsEnabled,
          providerThreadId: "claude-session-1",
        },
      }),
    ).toBeNull();
  });
});
