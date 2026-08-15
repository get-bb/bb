import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { decodeClaudeCodeJsonRpcRequest } from "../commands.js";

const baseThreadStartParams = {
  threadId: "bb-thread-1",
  cwd: "/tmp/worktree",
  baseInstructions: "test",
  permissionMode: "default",
  approvedPlanPermissionMode: "default",
  permissionScope: "workspace",
  permissionEscalation: "ask",
  instructionMode: "append",
  workflowsEnabled: false,
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
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
      kind: "request",
      request: {
        method: "thread/start",
        params: { workflowsEnabled: false },
      },
    });
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
    ).toMatchObject({
      kind: "invalid_params",
      id: 1,
      method: "thread/start",
      issues: expect.stringContaining("workflowsEnabled"),
    });
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
    ).toMatchObject({
      kind: "invalid_params",
      id: 2,
      method: "thread/resume",
    });
  });

  it("reports an unknown method separately from invalid params", () => {
    expect(
      decodeClaudeCodeJsonRpcRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "turn/teleport",
        params: {},
      }),
    ).toEqual({ kind: "unknown_method", id: 3, method: "turn/teleport" });
  });

  it("ignores lines that are not requests", () => {
    expect(
      decodeClaudeCodeJsonRpcRequest({ jsonrpc: "2.0", id: 4, result: {} }),
    ).toEqual({ kind: "not_a_request" });
  });
});
