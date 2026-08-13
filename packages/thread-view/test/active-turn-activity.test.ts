import { describe, expect, it } from "vitest";
import type { EventProjection } from "../src/event-projection.js";
import type { EventProjectionMessage } from "../src/event-projection-message.js";
import { resolveThreadTimelineActiveTurnActivity } from "../src/active-turn-activity.js";

const base = {
  threadId: "thr_test",
  scope: { kind: "turn" as const, turnId: "turn_test" },
};

function projection(messages: EventProjectionMessage[]): EventProjection {
  return {
    state: {
      activeTurnActivity: null,
      activeThinking: null,
      activeWorkflows: [],
      activeBackgroundCommands: [],
    },
    entries: [
      {
        kind: "turn",
        turn: {
          turnId: "turn_test",
          threadId: "thr_test",
          sourceSeqStart: 1,
          sourceSeqEnd: Math.max(
            1,
            ...messages.map((message) => message.sourceSeqEnd),
          ),
          startedAt: 1_000,
          createdAt: 1_000,
          completedAt: null,
          status: "pending",
          summaryCount: messages.length,
          messages,
        },
      },
    ],
  };
}

describe("resolveThreadTimelineActiveTurnActivity", () => {
  it("classifies the newest pending command and preserves its latest progress time", () => {
    const command: EventProjectionMessage = {
      ...base,
      kind: "command",
      id: "command-1",
      sourceSeqStart: 2,
      sourceSeqEnd: 4,
      startedAt: 2_000,
      createdAt: 4_000,
      callId: "call-1",
      command: "pnpm test",
      cwd: "/repo",
      parsedIntents: [],
      source: null,
      output: "still running",
      exitCode: null,
      completedAt: null,
      approvalStatus: null,
      status: "pending",
    };

    expect(
      resolveThreadTimelineActiveTurnActivity({
        projection: projection([command]),
        threadStatus: "active",
      }),
    ).toEqual({
      phase: "command",
      detail: "pnpm test",
      startedAt: 2_000,
      updatedAt: 4_000,
      lastProgressSequence: 4,
      quietThresholdMs: 300_000,
    });
  });

  it("uses provider wait before the first material event and clears for idle threads", () => {
    const activeProjection = projection([]);
    expect(
      resolveThreadTimelineActiveTurnActivity({
        projection: activeProjection,
        threadStatus: "active",
      }),
    ).toMatchObject({
      phase: "provider",
      updatedAt: 1_000,
      quietThresholdMs: 120_000,
    });
    expect(
      resolveThreadTimelineActiveTurnActivity({
        projection: activeProjection,
        threadStatus: "idle",
      }),
    ).toBeNull();
  });

  it("tracks provider wait before turn/started arrives", () => {
    const pendingRequest: EventProjection = {
      state: {
        activeTurnActivity: null,
        activeThinking: null,
        activeWorkflows: [],
        activeBackgroundCommands: [],
      },
      entries: [
        {
          kind: "projected-message",
          message: {
            ...base,
            kind: "user",
            id: "request-1",
            sourceSeqStart: 1,
            sourceSeqEnd: 1,
            createdAt: 1_500,
            initiator: "user",
            senderThreadId: null,
            systemMessageKind: "unlabeled",
            systemMessageSubject: null,
            turnRequest: {
              isGrouped: false,
              kind: "message",
              status: "pending",
            },
            text: "Start",
            mentions: [],
          },
        },
      ],
    };

    expect(
      resolveThreadTimelineActiveTurnActivity({
        projection: pendingRequest,
        threadStatus: "active",
      }),
    ).toMatchObject({
      phase: "provider",
      updatedAt: 1_500,
      lastProgressSequence: 1,
    });
  });

  it("gives pending subagents a longer quiet threshold", () => {
    const delegation: EventProjectionMessage = {
      ...base,
      kind: "delegation",
      id: "delegation-1",
      sourceSeqStart: 2,
      sourceSeqEnd: 3,
      createdAt: 3_000,
      callId: "call-agent",
      toolName: "spawnAgent",
      description: "Investigate the provider",
      output: "",
      completedAt: null,
      status: "pending",
      childProjection: projection([]),
    };

    expect(
      resolveThreadTimelineActiveTurnActivity({
        projection: projection([delegation]),
        threadStatus: "active",
      }),
    ).toMatchObject({
      phase: "subagent",
      detail: "Investigate the provider",
      quietThresholdMs: 600_000,
    });
  });
});
