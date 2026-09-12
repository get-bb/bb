import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Thread,
} from "@bb/domain";
import {
  createConnection,
  getAppSettings,
  getLatestThreadSequence,
} from "@bb/db";
import {
  applyTimelineDelta,
  threadTimelineResponseSchema,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import { buildThreadTimelineWithProfile } from "../../src/services/threads/timeline.js";
import { previewTimelineResponseOutputs } from "../../src/services/threads/timeline-output-preview.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  truncateTimelineResponseOutputs,
} from "../../src/services/threads/timeline-output-truncation.js";
import { readTimelineSelectionMemoSize } from "../../src/services/threads/timeline-selection-memo.js";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  afterSequence?: number,
): Promise<ThreadTimelineResponse> {
  const url =
    afterSequence === undefined
      ? `/api/v1/threads/${threadId}/timeline`
      : `/api/v1/threads/${threadId}/timeline?afterSequence=${afterSequence}`;
  const response = await harness.app.request(url);
  if (response.status !== 200) {
    throw new Error(
      `timeline ${url} -> ${response.status}: ${await response.text()}`,
    );
  }
  return threadTimelineResponseSchema.parse(await readJson(response));
}

function buildColdLatestRows(
  harness: TestAppHarness,
  thread: Thread,
): TimelineRow[] {
  const clone = createConnection(harness.deps.db.$client.serialize());
  try {
    const { response } = buildThreadTimelineWithProfile(clone, thread, {
      eventBudget: harness.deps.config.featureFlags.timelineWindowEventBudget,
      includeDiagnosticOperations: getAppSettings(clone).showDiagnosticEvents,
      includeNestedRows: false,
      maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      maxSeq: getLatestThreadSequence(clone, { threadId: thread.id }),
      page: { kind: "latest", segmentLimit: 20 },
      providerDisplayName: "Codex",
      planCommand: null,
      summaryOnly: false,
    });
    return previewTimelineResponseOutputs(
      truncateTimelineResponseOutputs(
        response,
        DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      ),
    ).rows;
  } finally {
    clone.$client.close();
  }
}

function assistantText(rows: readonly TimelineRow[]): string | null {
  for (const row of rows) {
    if (row.kind === "conversation" && row.role === "assistant") {
      return row.text;
    }
    if (row.kind === "turn" && row.children !== null) {
      const nested = assistantText(row.children);
      if (nested !== null) return nested;
    }
  }
  return null;
}

describe("GET /threads/:id/timeline?afterSequence (row-patch delta)", () => {
  it("a full fetch carries no delta and echoes maxSeq", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "hello" },
      });

      const full = await getTimeline(harness, thread.id);
      expect(full.delta).toBeUndefined();
      expect(full.rows.length).toBeGreaterThan(0);
      expect(full.maxSeq).toBe(1);
    });
  });

  it("delta + merge reproduces a fresh full window when rows are appended", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 2,
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

      const before = await getTimeline(harness, thread.id);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "Done." },
        },
      });

      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();
      expect(delta.rows).toHaveLength(0);
      expect(delta.maxSeq).toBe(3);
      expect(delta.delta!.upsertRows.length).toBeGreaterThan(0);

      const merged = applyTimelineDelta(before.rows, delta.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).toEqual(fresh.rows);
    });
  });

  it("delta + merge reproduces a fresh full window when a turn completes (collapse)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      seedEvent(harness.deps, {
        ...turn,
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "tool-1",
            tool: "exec_command",
            arguments: { cmd: "ls" },
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 3,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "First." },
        },
      });

      const before = await getTimeline(harness, thread.id);

      seedEvent(harness.deps, {
        ...turn,
        sequence: 4,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();

      const merged = applyTimelineDelta(before.rows, delta.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).not.toBeNull();
      expect(merged).toEqual(fresh.rows);
      expect(fresh.rows).not.toEqual(before.rows);
      const beforeIds = new Set(before.rows.map((row) => row.id));
      const freshIds = new Set(fresh.rows.map((row) => row.id));
      expect([...beforeIds].some((id) => !freshIds.has(id))).toBe(true);
    });
  });

  it("two interleaved clients both receive deltas (snapshot ring per params key)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      let sequence = 0;
      const appendMessage = (text: string): void => {
        sequence += 1;
        seedEvent(harness.deps, {
          ...turn,
          sequence,
          type: "item/completed",
          data: {
            item: { type: "agentMessage", id: `assistant-${sequence}`, text },
          },
        });
      };
      sequence += 1;
      seedEvent(harness.deps, {
        ...turn,
        sequence,
        type: "turn/started",
        data: {},
      });
      appendMessage("one");

      const desktop = await getTimeline(harness, thread.id);
      const phone = desktop;

      appendMessage("two");
      const desktopAt3 = await getTimeline(harness, thread.id, desktop.maxSeq);
      expect(desktopAt3.delta).toBeDefined();
      appendMessage("three");
      const desktopAt4 = await getTimeline(
        harness,
        thread.id,
        desktopAt3.maxSeq,
      );
      expect(desktopAt4.delta).toBeDefined();

      const phoneAt4 = await getTimeline(harness, thread.id, phone.maxSeq);
      expect(phoneAt4.maxSeq).toBe(4);
      expect(phoneAt4.rows).toHaveLength(0);
      expect(phoneAt4.delta).toBeDefined();
      const merged = applyTimelineDelta(phone.rows, phoneAt4.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).toEqual(fresh.rows);

      for (const text of ["four", "five", "six", "seven"]) {
        appendMessage(text);
        const polled = await getTimeline(harness, thread.id, sequence - 1);
        expect(polled.delta).toBeDefined();
      }
      const evicted = await getTimeline(harness, thread.id, 2);
      expect(evicted.delta).toBeUndefined();
      expect(evicted.rows.length).toBeGreaterThan(0);
    });
  });

  it("streaming deltas: delta + merge equals a cold window on invisible and visible ticks", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        scope: threadScope(),
        sequence: 1,
        type: "client/turn/requested",
        data: {
          direction: "outbound",
          source: "tell",
          initiator: "user",
          request: { method: "turn/start", params: {} },
          requestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Write a poem", mentions: [] }],
          target: { kind: "thread-start" },
          execution: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            permissionMode: "full",
            source: "client/turn/requested",
          },
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
        data: { clientRequestId: requestId },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 4,
        type: "item/started",
        data: { item: { type: "agentMessage", id: "assistant-1", text: "" } },
      });

      let before = await getTimeline(harness, thread.id);
      let sequence = before.maxSeq;
      let streamed = "";
      let visibleText = assistantText(before.rows) ?? "";
      const chunks = [
        "Roses",
        " are red",
        "\nViolets",
        " are",
        " blue\n",
        "Sugar",
      ];
      for (const chunk of chunks) {
        sequence += 1;
        streamed += chunk;
        seedEvent(harness.deps, {
          ...turn,
          sequence,
          type: "item/agentMessage/delta",
          data: { itemId: "assistant-1", delta: chunk },
        });

        const tick = await getTimeline(harness, thread.id, before.maxSeq);
        expect(tick.maxSeq).toBe(sequence);
        expect(tick.delta).toBeDefined();
        const merged = applyTimelineDelta(before.rows, tick.delta!);
        expect(merged).toEqual(buildColdLatestRows(harness, thread));

        const nextVisibleText = assistantText(merged ?? []) ?? "";
        expect(nextVisibleText.startsWith(visibleText)).toBe(true);
        expect(streamed.startsWith(nextVisibleText)).toBe(true);
        expect(nextVisibleText).toBe(
          streamed.slice(0, streamed.lastIndexOf("\n") + 1),
        );
        visibleText = nextVisibleText;
        before = { ...tick, rows: merged ?? [] };
      }
      expect(visibleText).toBe("Roses are red\nViolets are blue\n");
      expect(
        readTimelineSelectionMemoSize(harness.deps.db).entryCount,
      ).toBeGreaterThan(0);
    });
  });

  it("a no-op delta (no new events) returns an empty patch and merges to the same rows", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "hello" },
      });

      const before = await getTimeline(harness, thread.id);
      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();
      expect(delta.delta!.upsertRows).toHaveLength(0);
      expect(delta.delta!.rowOrder).toBeUndefined();
      expect(applyTimelineDelta(before.rows, delta.delta!)).toEqual(
        before.rows,
      );
    });
  });
});
