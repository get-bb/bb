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
