import { describe, expect, it } from "vitest";
import {
  codexThreadIdentityResultSchema,
  extractCodexSubAgentHistory,
} from "./subagent-history.js";

describe("Codex subagent history", () => {
  it("restores the original delegation identity for each child", () => {
    const result = codexThreadIdentityResultSchema.parse({
      thread: {
        id: "root-thread",
        turns: [
          {
            id: "parent-turn-a",
            items: [
              {
                type: "subAgentActivity",
                id: "spawn-a-old",
                kind: "started",
                agentThreadId: "child-a",
                agentPath: "/root/child_a",
              },
              {
                type: "subAgentActivity",
                id: "message-a",
                kind: "interacted",
                agentThreadId: "child-a",
                agentPath: "/root/child_a",
              },
            ],
          },
          {
            id: "parent-turn-b",
            items: [
              {
                type: "subAgentActivity",
                id: "spawn-b",
                kind: "started",
                agentThreadId: "child-b",
                agentPath: "/root/child_b",
              },
              {
                type: "subAgentActivity",
                id: "spawn-a",
                kind: "started",
                agentThreadId: "child-a",
                agentPath: "/root/child_a",
              },
            ],
          },
        ],
      },
    });

    expect(extractCodexSubAgentHistory(result.thread)).toEqual([
      {
        agentPath: "/root/child_a",
        agentThreadId: "child-a",
        callId: "spawn-a-old",
        parentProviderThreadId: "root-thread",
        parentTurnId: "parent-turn-a",
      },
      {
        agentPath: "/root/child_b",
        agentThreadId: "child-b",
        callId: "spawn-b",
        parentProviderThreadId: "root-thread",
        parentTurnId: "parent-turn-b",
      },
    ]);
  });

  it("defaults missing history and ignores malformed activity items", () => {
    const empty = codexThreadIdentityResultSchema.parse({
      thread: { id: "root-thread" },
    });
    expect(extractCodexSubAgentHistory(empty.thread)).toEqual([]);

    const malformed = codexThreadIdentityResultSchema.parse({
      thread: {
        id: "root-thread",
        turns: [
          {
            id: "parent-turn",
            items: [
              {
                type: "subAgentActivity",
                id: "spawn-a",
                kind: "started",
                agentThreadId: null,
                agentPath: "/root/child_a",
              },
            ],
          },
        ],
      },
    });
    expect(extractCodexSubAgentHistory(malformed.thread)).toEqual([]);
  });
});
