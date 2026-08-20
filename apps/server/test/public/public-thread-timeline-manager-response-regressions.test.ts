import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  threadTimelineResponseSchema,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { pruneThreadEventHistory } from "../../src/services/system/event-pruning.js";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

const EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
): Promise<ThreadTimelineResponse> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

function topLevelConversations(rows: readonly TimelineRow[]) {
  return rows.filter(
    (row): row is Extract<TimelineRow, { kind: "conversation" }> =>
      row.kind === "conversation",
  );
}

describe("GET /threads/:id/timeline manager response boundaries", () => {
  it("keeps the cproxy response, child completion, and final response top-level", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "cproxy-session-1",
        scope: turnScope("turn-cproxy"),
      } as const;
      const childTellRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
      const lifecycleRequestId = encodeClientTurnRequestIdNumber({ value: 2 });

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: childTellRequestId,
          source: "tell",
          initiator: "agent",
          senderThreadId: "thr_cproxy_child",
          input: [
            { type: "text", text: "Child report: implementation ready." },
          ],
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: EXECUTION,
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 3,
        type: "turn/input/accepted",
        data: { clientRequestId: childTellRequestId },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 4,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "cproxy-assistant-detailed",
            text: "I reviewed the full implementation and confirmed each important invariant.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 5,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: lifecycleRequestId,
          source: "tell",
          initiator: "system",
          senderThreadId: null,
          systemMessageKind: "child-completed",
          systemMessageSubject: {
            kind: "thread",
            threadId: "thr_cproxy_child",
            threadName: "cproxy worker",
          },
          input: [
            {
              type: "text",
              text: "cproxy worker completed: implementation ready.",
            },
          ],
          target: { kind: "auto", expectedTurnId: "turn-cproxy" },
          request: { method: "turn/start", params: {} },
          execution: EXECUTION,
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 6,
        type: "turn/input/accepted",
        data: { clientRequestId: lifecycleRequestId },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 7,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "cproxy-assistant-final",
            text: "Done.",
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 8,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const timeline = await getTimeline(harness, thread.id);
      const conversations = topLevelConversations(timeline.rows);
      expect(conversations.map((row) => row.text)).toEqual([
        "Child report: implementation ready.",
        "I reviewed the full implementation and confirmed each important invariant.",
        "cproxy worker completed: implementation ready.",
        "Done.",
      ]);
      const assistantRows = conversations.filter(
        (row) => row.role === "assistant",
      );
      expect(assistantRows).toHaveLength(2);
      expect(new Set(assistantRows.map((row) => row.id)).size).toBe(2);
    });
  });

  it("keeps Terminal-Bench assistant texts recoverable after resolved-delta pruning", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "terminal-bench-session-1",
        scope: turnScope("turn-terminal-bench"),
      } as const;
      const lifecycleRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
      const firstText =
        "The complete Terminal-Bench analysis remains visible across the lifecycle steer.";

      seedEvent(harness.deps, {
        ...turn,
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "item/agentMessage/delta",
        data: {
          itemId: "terminal-assistant-detailed",
          delta: "The complete Terminal-Bench analysis remains visible ",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 3,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: lifecycleRequestId,
          source: "tell",
          initiator: "system",
          senderThreadId: null,
          systemMessageKind: "child-completed",
          systemMessageSubject: {
            kind: "thread",
            threadId: "thr_terminal_bench",
            threadName: "Terminal-Bench worker",
          },
          input: [
            {
              type: "text",
              text: "Terminal-Bench worker completed: checks passed.",
            },
          ],
          target: {
            kind: "auto",
            expectedTurnId: "turn-terminal-bench",
          },
          request: { method: "turn/start", params: {} },
          execution: EXECUTION,
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 4,
        type: "turn/input/accepted",
        data: { clientRequestId: lifecycleRequestId },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 5,
        type: "item/agentMessage/delta",
        data: {
          itemId: "terminal-assistant-detailed",
          delta: "across the lifecycle steer.",
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 6,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "terminal-assistant-detailed",
            text: firstText,
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 7,
        type: "item/completed",
        data: {
          item: {
            type: "commandExecution",
            id: "terminal-tool-boundary",
            command: "terminal-bench run --task regression",
            cwd: "/repo",
            status: "completed",
            approvalStatus: null,
            exitCode: 0,
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 8,
        type: "item/agentMessage/delta",
        data: {
          itemId: "terminal-assistant-final",
          delta: "Verified.",
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 9,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "terminal-assistant-final",
            text: "Verified.",
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 10,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const pruning = pruneThreadEventHistory(harness.deps, {
        mode: "idle",
        threadId: thread.id,
      });
      expect(pruning.removedResolvedItemDeltas).toBe(1);

      const timeline = await getTimeline(harness, thread.id);
      const conversations = topLevelConversations(timeline.rows);
      expect(conversations.map((row) => row.text)).toEqual([
        firstText,
        "Terminal-Bench worker completed: checks passed.",
        "Verified.",
      ]);
      const assistantRows = conversations.filter(
        (row) => row.role === "assistant",
      );
      expect(assistantRows).toHaveLength(2);
      expect(new Set(assistantRows.map((row) => row.id)).size).toBe(2);
    });
  });
});
