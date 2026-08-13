import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import { createPrimeAgentProviderAdapter } from "./adapter.js";

const executionContext = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  workflowsEnabled: false,
  permissionMode: "full" as const,
  permissionScope: "full" as const,
  approvalReviewer: null,
  permissionEscalation: null,
};

describe("Prime Agent provider adapter", () => {
  it("maps sessions onto the native Prime Agent bridge contract", () => {
    const adapter = createPrimeAgentProviderAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/start",
        threadId: "thread-1",
        cwd: "/workspace",
        options: {
          ...executionContext,
          model: "openai-codex/gpt-5.6-sol",
          reasoningLevel: "high",
          skillRoots: [
            {
              id: "global-prime",
              providerId: "prime-agent",
              skillDirectoryRootPath: "/tmp/skills",
            },
          ],
        },
        instructionMode: "replace",
      }),
    ).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        threadId: "thread-1",
        cwd: "/workspace",
        model: "openai-codex/gpt-5.6-sol",
        reasoningLevel: "high",
        additionalSkillPaths: ["/tmp/skills"],
      },
    });
  });

  it("uses the native rename control", () => {
    const adapter = createPrimeAgentProviderAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/name/set",
        threadId: "thread-1",
        providerThreadId: "/tmp/session.jsonl",
        title: "native prime session",
      }),
    ).toEqual({
      kind: "request",
      method: "thread/name/set",
      params: {
        threadId: "/tmp/session.jsonl",
        title: "native prime session",
      },
    });
    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "thread-1",
          message: {
            type: "session_info_changed",
            name: "native prime session",
          },
        },
      }),
    ).toEqual([
      {
        type: "thread/name/updated",
        threadId: "thread-1",
        providerThreadId: "",
        threadName: "native prime session",
        scope: { kind: "thread" },
      },
    ]);
  });

  it("preserves the BB thread identity when resuming a native session", () => {
    const adapter = createPrimeAgentProviderAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/resume",
        threadId: "thread-1",
        providerThreadId: "/tmp/session.jsonl",
        cwd: "/workspace",
        options: executionContext,
        instructionMode: "append",
      }),
    ).toMatchObject({
      kind: "request",
      method: "thread/resume",
      params: {
        threadId: "/tmp/session.jsonl",
        sourceThreadId: "thread-1",
      },
    });
  });

  it("rejects unsupported dynamic tool policy instead of ignoring it", () => {
    const adapter = createPrimeAgentProviderAdapter();
    expect(() =>
      adapter.buildCommandPlan({
        type: "thread/start",
        threadId: "thread-1",
        cwd: "/workspace",
        options: executionContext,
        dynamicTools: [
          {
            name: "bb_test",
            description: "test",
            inputSchema: { type: "object" },
          },
        ],
        instructionMode: "append",
      }),
    ).toThrow(/does not support BB dynamic tools/u);
  });

  it("translates native AgentSession events under the Prime Agent identity", () => {
    const adapter = createPrimeAgentProviderAdapter({ turnIdPrefix: "prime_" });
    expect(
      adapter.translateEvent({ type: "agent_start" }, { threadId: "thread-1" }),
    ).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: { kind: "turn", turnId: "prime_1" },
      }),
    );
  });
});
