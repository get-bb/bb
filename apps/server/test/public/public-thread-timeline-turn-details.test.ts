import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  type TimelineRow,
  threadTimelineResponseSchema,
  timelineTurnSummaryDetailsResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

type TimelineTurnRow = Extract<TimelineRow, { kind: "turn" }>;

describe("public timeline turn summary details", () => {
  it("hydrates an interaction-only summary range before a user steer", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const eventContext = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
      };
      seedEvent(harness.deps, {
        ...eventContext,
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      for (const [sequence, status] of [
        [2, "pending"],
        [3, "resolved"],
      ] as const) {
        seedEvent(harness.deps, {
          ...eventContext,
          scope: threadScope(),
          sequence,
          type: "system/interaction/lifecycle",
          data: {
            interaction: {
              id: "plugin-question",
              status,
              statusReason: null,
              origin: {
                kind: "plugin",
                pluginId: "ask-user-question",
                rendererId: "question",
              },
              payload: { kind: "plugin", title: "Choose an approach" },
              resolution:
                status === "resolved" ? { kind: "plugin_submitted" } : null,
            },
          },
        });
      }
      const clientRequestId = encodeClientTurnRequestIdNumber({ value: 101 });
      seedEvent(harness.deps, {
        ...eventContext,
        scope: threadScope(),
        sequence: 4,
        type: "client/turn/requested",
        data: {
          direction: "outbound",
          requestId: clientRequestId,
          input: [{ type: "text", text: "Use the simpler approach" }],
          target: { kind: "steer", expectedTurnId: "turn-1" },
          execution: {
            model: "gpt-4o-mini",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "fast",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: { method: "turn/start", params: {} },
          source: "tell",
        },
      });
      seedEvent(harness.deps, {
        ...eventContext,
        scope: turnScope("turn-1"),
        sequence: 5,
        type: "turn/input/accepted",
        data: { clientRequestId },
      });
      seedEvent(harness.deps, {
        ...eventContext,
        scope: turnScope("turn-1"),
        sequence: 6,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "Done." },
        },
      });
      seedEvent(harness.deps, {
        ...eventContext,
        scope: turnScope("turn-1"),
        sequence: 7,
        type: "turn/completed",
        data: { status: "completed" },
      });
      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );
      const turnRow = timeline.rows.find(
        (row): row is TimelineTurnRow =>
          row.kind === "turn" && row.sourceSeqEnd === 3,
      );
      expect(turnRow).toMatchObject({
        turnId: "turn-1",
        sourceSeqStart: 2,
        sourceSeqEnd: 3,
      });
      if (!turnRow) throw new Error("Expected an interaction-only summary");
      const detailsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${turnRow.turnId}&sourceSeqStart=${turnRow.sourceSeqStart}&sourceSeqEnd=${turnRow.sourceSeqEnd}`,
      );
      expect(detailsResponse.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(detailsResponse),
      );
      expect(details.rows).toEqual([
        expect.objectContaining({
          kind: "work",
          workKind: "form",
          interactionId: "plugin-question",
          lifecycle: "submitted",
          sourceSeqStart: 2,
          sourceSeqEnd: 3,
        }),
      ]);
    });
  });

  it.each([
    { range: 4, description: "another turn's work" },
    { range: 5, description: "a standalone thread event" },
    { range: 6, description: "an interaction during another turn" },
  ])("rejects turn details for $description", async ({ range }) => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const eventContext = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
      };
      for (const [sequence, turnId] of [
        [1, "turn-1"],
        [3, "turn-2"],
      ] as const) {
        seedEvent(harness.deps, {
          ...eventContext,
          scope: turnScope(turnId),
          sequence,
          type: "turn/started",
          data: {},
        });
      }
      seedEvent(harness.deps, {
        ...eventContext,
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "turn/completed",
        data: { status: "completed" },
      });
      seedEvent(harness.deps, {
        ...eventContext,
        scope: turnScope("turn-2"),
        sequence: 4,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "other-tool",
            tool: "exec_command",
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        ...eventContext,
        scope: threadScope(),
        sequence: 5,
        type: "system/error",
        data: { message: "Standalone error" },
      });
      seedEvent(harness.deps, {
        ...eventContext,
        scope: threadScope(),
        sequence: 6,
        type: "system/interaction/lifecycle",
        data: {
          interaction: {
            id: "other-question",
            status: "resolved",
            statusReason: null,
            origin: {
              kind: "plugin",
              pluginId: "ask-user-question",
              rendererId: "question",
            },
            payload: { kind: "plugin", title: "Another turn's question" },
            resolution: { kind: "plugin_submitted" },
          },
        },
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-1&sourceSeqStart=${range}&sourceSeqEnd=${range}`,
      );
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        code: "invalid_request",
        message: `Timeline turn summary details range ${range}-${range} does not include turn turn-1`,
      });
    });
  });
});
