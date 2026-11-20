import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type PromptInput,
  type TurnRequestTarget,
} from "@bb/domain";
import {
  threadMessageResponseSchema,
  threadTimelineResponseSchema,
  type TimelineRow,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import type { AppDeps } from "../../src/types.js";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

interface SeedRequestArgs {
  threadId: string;
  environmentId: string;
  sequence: number;
  requestId: number;
  input: PromptInput[];
  target: TurnRequestTarget;
}

function seedRequest(
  deps: Pick<AppDeps, "db" | "hub">,
  args: SeedRequestArgs,
): void {
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: args.sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: encodeClientTurnRequestIdNumber({ value: args.requestId }),
      input: args.input,
      target: args.target,
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
}

function seedTurnEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    threadId: string;
    environmentId: string;
    sequence: number;
    type: "turn/started" | "turn/input/accepted" | "item/completed";
    data: Record<string, unknown>;
  },
): void {
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-thread-1",
    scope: turnScope("turn-1"),
    sequence: args.sequence,
    type: args.type,
    data: args.data,
  });
}

function collectConversationRows(
  rows: readonly TimelineRow[],
): Extract<TimelineRow, { kind: "conversation" }>[] {
  return rows.flatMap((row) => {
    if (row.kind === "conversation") {
      return [row];
    }
    const nested =
      ("childRows" in row ? row.childRows : undefined) ??
      ("children" in row ? row.children : undefined) ??
      [];
    return collectConversationRows(nested);
  });
}

function seedSteeredThread(
  deps: Pick<AppDeps, "db" | "hub">,
  ids: {
    threadId: string;
    environmentId: string;
  },
): void {
  seedRequest(deps, {
    ...ids,
    sequence: 1,
    requestId: 101,
    input: [{ type: "text", text: "First question", mentions: [] }],
    target: { kind: "new-turn" },
  });
  seedTurnEvent(deps, { ...ids, sequence: 2, type: "turn/started", data: {} });
  seedTurnEvent(deps, {
    ...ids,
    sequence: 3,
    type: "turn/input/accepted",
    data: {
      clientRequestId: encodeClientTurnRequestIdNumber({ value: 101 }),
    },
  });
  seedTurnEvent(deps, {
    ...ids,
    sequence: 4,
    type: "item/completed",
    data: { item: { type: "agentMessage", id: "a-1", text: "Working on it" } },
  });
  seedRequest(deps, {
    ...ids,
    sequence: 5,
    requestId: 102,
    input: [{ type: "text", text: "Also check the tests", mentions: [] }],
    target: { kind: "steer", expectedTurnId: "turn-1" },
  });
  seedTurnEvent(deps, {
    ...ids,
    sequence: 6,
    type: "item/completed",
    data: {
      item: {
        type: "toolCall",
        id: "tool-1",
        tool: "exec_command",
        arguments: { cmd: "pnpm test" },
        status: "completed",
      },
    },
  });
  seedTurnEvent(deps, {
    ...ids,
    sequence: 7,
    type: "turn/input/accepted",
    data: {
      clientRequestId: encodeClientTurnRequestIdNumber({ value: 102 }),
    },
  });
  seedTurnEvent(deps, {
    ...ids,
    sequence: 8,
    type: "item/completed",
    data: { item: { type: "agentMessage", id: "a-2", text: "Done" } },
  });
  seedRequest(deps, {
    ...ids,
    sequence: 9,
    requestId: 103,
    input: [
      {
        type: "text",
        text: "Hidden workflow context",
        mentions: [],
        visibility: "agent-only",
      },
    ],
    target: { kind: "new-turn" },
  });
}

function seedMultiTurnThread(
  deps: Pick<AppDeps, "db" | "hub">,
  ids: { threadId: string; environmentId: string },
): void {
  let sequence = 0;
  const request = (
    requestId: number,
    text: string,
    target: TurnRequestTarget = { kind: "new-turn" },
  ) =>
    seedRequest(deps, {
      ...ids,
      sequence: (sequence += 1),
      requestId,
      input: [{ type: "text", text, mentions: [] }],
      target,
    });
  const inTurn = (
    turnId: string,
    type:
      | "turn/started"
      | "turn/input/accepted"
      | "item/started"
      | "item/completed"
      | "turn/completed",
    data: Record<string, unknown>,
  ) =>
    seedEvent(deps, {
      ...ids,
      providerThreadId: "provider-thread-1",
      scope: turnScope(turnId),
      sequence: (sequence += 1),
      type,
      data,
    });
  const accepted = (turnId: string, requestId: number) =>
    inTurn(turnId, "turn/input/accepted", {
      clientRequestId: encodeClientTurnRequestIdNumber({ value: requestId }),
    });
  const answer = (turnId: string, text: string) =>
    inTurn(turnId, "item/completed", {
      item: { type: "agentMessage", id: `${turnId}-answer`, text },
    });
  const backgroundTask = (status: "pending" | "completed") => ({
    item: {
      type: "backgroundTask",
      id: "task:long-1",
      taskType: "local_workflow",
      description: "long workflow",
      status,
      taskStatus: status === "completed" ? "completed" : "running",
      skipTranscript: false,
      foreground: false,
      workflowName: "long-workflow",
      ...(status === "completed" ? { summary: "done" } : {}),
    },
  });
  const turn = (index: number, extra: () => void = () => {}) => {
    const turnId = `turn-${index}`;
    request(200 + index, `Question ${index}`);
    inTurn(turnId, "turn/started", {});
    accepted(turnId, 200 + index);
    extra();
    answer(turnId, `Answer ${index}`);
    inTurn(turnId, "turn/completed", { status: "completed" });
  };

  turn(1, () => {
    inTurn("turn-1", "item/started", backgroundTask("pending"));
    request(301, "Queued while turn 1 runs");
  });
  inTurn("turn-q", "turn/started", {});
  accepted("turn-q", 301);
  answer("turn-q", "Answer to the queued message");
  inTurn("turn-q", "turn/completed", { status: "completed" });
  turn(2, () => {
    request(302, "Steer into turn 2", {
      kind: "steer",
      expectedTurnId: "turn-2",
    });
    accepted("turn-2", 302);
  });
  turn(3);
  seedEvent(deps, {
    ...ids,
    providerThreadId: "provider-thread-1",
    scope: threadScope(),
    sequence: (sequence += 1),
    type: "item/backgroundTask/completed",
    data: backgroundTask("completed"),
  });
  turn(4);
  request(303, "Steer that is never accepted", {
    kind: "steer",
    expectedTurnId: "turn-4",
  });
  turn(5);
  turn(6);
}

describe("thread messages", () => {
  it("resolves every timeline conversation row by its message seq", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedSteeredThread(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
      });

      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline?includeNestedRows=true`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );
      const conversationRows = collectConversationRows(timeline.rows);
      expect(
        conversationRows.map((row) => [
          row.messageSeq,
          row.sourceSeqEnd,
          row.role,
          row.text,
        ]),
      ).toEqual([
        [1, 1, "user", "First question"],
        [4, 4, "assistant", "Working on it"],
        [5, 7, "user", "Also check the tests"],
        [8, 8, "assistant", "Done"],
      ]);

      for (const row of conversationRows) {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/messages/${row.messageSeq}`,
        );
        expect(response.status).toBe(200);
        const { message } = threadMessageResponseSchema.parse(
          await readJson(response),
        );
        expect(message).toMatchObject({
          id: row.id,
          messageSeq: row.messageSeq,
          role: row.role,
          text: row.text,
        });
      }
    });
  });

  it("returns neighbouring messages in timeline order", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedSteeredThread(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/messages/5?before=5&after=5`,
      );
      expect(response.status).toBe(200);
      const body = threadMessageResponseSchema.parse(await readJson(response));
      expect(body.before.map((message) => message.messageSeq)).toEqual([1, 4]);
      expect(body.message.messageSeq).toBe(5);
      expect(body.after.map((message) => message.messageSeq)).toEqual([8]);

      const narrow = threadMessageResponseSchema.parse(
        await readJson(
          await harness.app.request(
            `/api/v1/threads/${thread.id}/messages/8?before=1`,
          ),
        ),
      );
      expect(narrow.before.map((message) => message.messageSeq)).toEqual([5]);
      expect(narrow.after).toEqual([]);
    });
  });

  it.each(["idle", "active"] as const)(
    "returns the same messages and neighbours as the whole conversation in a %s multi-turn thread",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { environment, thread } = seedThreadFixture(harness, {
          thread: { status },
        });
        seedMultiTurnThread(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
        });

        const timeline = threadTimelineResponseSchema.parse(
          await readJson(
            await harness.app.request(
              `/api/v1/threads/${thread.id}/timeline?includeNestedRows=true`,
            ),
          ),
        );
        const conversation = [
          ...collectConversationRows(timeline.rows),
          ...timeline.pendingSteers,
        ].map((row) => [row.messageSeq, row.id, row.text] as const);
        expect(conversation.map(([, , text]) => text)).toEqual([
          "Question 1",
          "Queued while turn 1 runs",
          "Answer 1",
          "Answer to the queued message",
          "Question 2",
          "Steer into turn 2",
          "Answer 2",
          "Question 3",
          "Answer 3",
          "Question 4",
          "Answer 4",
          "Question 5",
          "Answer 5",
          "Question 6",
          "Answer 6",
          ...(status === "active" ? ["Steer that is never accepted"] : []),
        ]);

        for (const [index, [messageSeq]] of conversation.entries()) {
          for (const [before, after] of [
            [0, 0],
            [1, 1],
            [2, 3],
            [20, 20],
          ] as const) {
            const response = await harness.app.request(
              `/api/v1/threads/${thread.id}/messages/${messageSeq}?before=${before}&after=${after}`,
            );
            expect(response.status).toBe(200);
            const body = threadMessageResponseSchema.parse(
              await readJson(response),
            );
            expect(
              [...body.before, body.message, ...body.after].map(
                (row) => [row.messageSeq, row.id, row.text] as const,
              ),
              `message ${messageSeq} with ${before} before and ${after} after`,
            ).toEqual(
              conversation.slice(
                Math.max(0, index - before),
                index + after + 1,
              ),
            );
          }
        }
      });
    },
  );

  it("reports sequences that hold no visible message as not found", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedSteeredThread(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
      });

      for (const seq of [6, 7, 9, 42]) {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/messages/${seq}`,
        );
        expect(response.status).toBe(404);
        await expect(readJson(response)).resolves.toMatchObject({
          code: "message_not_found",
        });
      }

      const invalid = await harness.app.request(
        `/api/v1/threads/${thread.id}/messages/7abc`,
      );
      expect(invalid.status).toBe(400);
    });
  });
});
