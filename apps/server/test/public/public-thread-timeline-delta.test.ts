import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Thread,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import { createConnection, getAppSettings, threads } from "@bb/db";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  threadTimelineReadResponseSchema,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import { countTimelineSelectionMemoEntries } from "../../src/services/threads/timeline-selection-memo.js";
import { readJson } from "../helpers/json.js";
import {
  seedEvent,
  seedThreadFixture,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import {
  buildRouteTimelinePage,
  latestTimelinePage,
} from "../provider-corpus/corpus-harness.js";

async function readTimeline(
  harness: TestAppHarness,
  threadId: string,
  afterTag?: string,
): Promise<ThreadTimelineReadResponse> {
  const url =
    afterTag === undefined
      ? `/api/v1/threads/${threadId}/timeline`
      : `/api/v1/threads/${threadId}/timeline?afterTag=${afterTag}`;
  const response = await harness.app.request(url);
  if (response.status !== 200) {
    throw new Error(
      `timeline ${url} -> ${response.status}: ${await response.text()}`,
    );
  }
  return threadTimelineReadResponseSchema.parse(await readJson(response));
}

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
): Promise<ThreadTimelineResponse> {
  const response = await readTimeline(harness, threadId);
  if (isThreadTimelineDelta(response)) {
    throw new Error("expected a full timeline window");
  }
  return response;
}

async function getDelta(
  harness: TestAppHarness,
  threadId: string,
  held: ThreadTimelineResponse,
) {
  const response = await readTimeline(harness, threadId, held.tag);
  if (!isThreadTimelineDelta(response)) {
    throw new Error("expected a timeline delta");
  }
  const applied = applyThreadTimelineDelta(held, response);
  if (applied === null) {
    throw new Error("timeline delta did not apply to the held window");
  }
  return { delta: response.delta, applied };
}

function setThreadStatus(
  harness: TestAppHarness,
  threadId: string,
  status: Thread["status"],
): void {
  harness.db
    .update(threads)
    .set({ status })
    .where(eq(threads.id, threadId))
    .run();
}

function buildColdLatestRows(
  harness: TestAppHarness,
  thread: Thread,
): TimelineRow[] {
  const clone = createConnection(harness.deps.db.$client.serialize());
  try {
    return buildRouteTimelinePage({
      db: clone,
      eventBudget: harness.deps.config.featureFlags.timelineWindowEventBudget,
      includeDiagnosticOperations: getAppSettings(clone).showDiagnosticEvents,
      page: latestTimelinePage(),
      registry: harness.deps.providerRegistry,
      thread,
      variant: "default",
    }).response.rows;
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

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /threads/:id/timeline?afterTag (row-patch delta)", () => {
  it("a full fetch carries a tag, no delta, and echoes maxSeq", async () => {
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
      expect(full.rows.length).toBeGreaterThan(0);
      expect(full.maxSeq).toBe(1);
      expect(full.tag.length).toBeGreaterThan(0);
      expect((await getTimeline(harness, thread.id)).tag).toBe(full.tag);
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

      const { delta, applied } = await getDelta(harness, thread.id, before);
      expect(delta.afterTag).toBe(before.tag);
      expect(delta.upsertRows.length).toBeGreaterThan(0);
      expect(delta.upsertRows.length).toBeLessThan(applied.rows.length);
      expect(applied).toEqual(await getTimeline(harness, thread.id));
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

      const { applied } = await getDelta(harness, thread.id, before);
      const fresh = await getTimeline(harness, thread.id);
      expect(applied).toEqual(fresh);
      const beforeIds = new Set(before.rows.map((row) => row.id));
      const freshIds = new Set(fresh.rows.map((row) => row.id));
      expect([...beforeIds].some((id) => !freshIds.has(id))).toBe(true);
    });
  });

  it("answers interleaved clients from the exact window each holds until the hold lapses", async () => {
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

      let desktop = await getTimeline(harness, thread.id);
      const phone = await getTimeline(harness, thread.id);
      expect(phone.tag).toBe(desktop.tag);
      for (const text of ["two", "three"]) {
        appendMessage(text);
        desktop = (await getDelta(harness, thread.id, desktop)).applied;
      }
      const fresh = await getTimeline(harness, thread.id);
      expect(desktop).toEqual(fresh);
      expect((await getDelta(harness, thread.id, phone)).applied).toEqual(
        fresh,
      );

      const stale = await getTimeline(harness, thread.id);
      appendMessage("four");
      await getTimeline(harness, thread.id);
      vi.useFakeTimers({ now: Date.now() + 30_001, toFake: ["Date"] });
      appendMessage("five");
      await getTimeline(harness, thread.id);
      const evicted = await readTimeline(harness, thread.id, stale.tag);
      expect(isThreadTimelineDelta(evicted)).toBe(false);
    });
  });

  it("diffs an idle-built window against the active window at the same sequence", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      seedTurnStarted(harness.deps, { ...turn, turnId: "turn-1" });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "item/started",
        data: {
          item: {
            type: "toolCall",
            id: "tool-1",
            tool: "exec_command",
            arguments: { cmd: "pnpm test" },
            status: "pending",
          },
        },
      });

      const idle = await getTimeline(harness, thread.id);
      setThreadStatus(harness, thread.id, "active");
      const active = await getTimeline(harness, thread.id);
      expect(active.maxSeq).toBe(idle.maxSeq);
      expect(active.tag).not.toBe(idle.tag);

      const fromIdle = await getDelta(harness, thread.id, idle);
      expect(fromIdle.delta.afterTag).toBe(idle.tag);
      expect(fromIdle.applied).toEqual(active);
      const fromActive = await getDelta(harness, thread.id, active);
      expect(fromActive.delta.upsertRows).toEqual([]);
      expect(fromActive.applied).toEqual(active);
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
      seedThreadRuntimeState(harness.deps, turn);
      seedTurnStarted(harness.deps, { ...turn, turnId: "turn-1" });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 4,
        type: "turn/input/accepted",
        data: {
          clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 5,
        type: "item/started",
        data: { item: { type: "agentMessage", id: "assistant-1", text: "" } },
      });

      let before = await getTimeline(harness, thread.id);
      let streamed = "";
      for (const chunk of [
        "Roses",
        " are red",
        "\nViolets",
        " are",
        " blue\n",
        "Sugar",
      ]) {
        streamed += chunk;
        seedEvent(harness.deps, {
          ...turn,
          sequence: before.maxSeq + 1,
          type: "item/agentMessage/delta",
          data: { itemId: "assistant-1", delta: chunk },
        });

        const tick = await getDelta(harness, thread.id, before);
        expect(tick.applied.maxSeq).toBe(before.maxSeq + 1);
        expect(tick.applied.rows).toEqual(buildColdLatestRows(harness, thread));
        expect(assistantText(tick.applied.rows) ?? "").toBe(
          streamed.slice(0, streamed.lastIndexOf("\n") + 1),
        );
        before = tick.applied;
      }
      expect(
        countTimelineSelectionMemoEntries(harness.deps.db),
      ).toBeGreaterThan(0);
    });
  });

  it("brings every viewer of a compacted thread to the compacted window at the unchanged sequence", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "before compaction" },
      });
      const before = await getTimeline(harness, thread.id);
      expect(JSON.stringify(before.rows)).toContain("before compaction");
      expect((await getTimeline(harness, thread.id)).tag).toBe(before.tag);

      harness.deps.db.$client
        .prepare(
          "UPDATE events SET data = ? WHERE thread_id = ? AND sequence = 1",
        )
        .run(JSON.stringify({ text: "after compaction" }), thread.id);
      harness.deps.hub.notifyThread(thread.id, ["history-compacted"]);

      const firstViewer = await getDelta(harness, thread.id, before);
      const secondViewer = await getDelta(harness, thread.id, before);
      for (const after of [firstViewer, secondViewer]) {
        expect(after.applied.maxSeq).toBe(before.maxSeq);
        expect(after.applied.tag).not.toBe(before.tag);
        expect(JSON.stringify(after.applied.rows)).toContain(
          "after compaction",
        );
        expect(after.applied).toEqual(await getTimeline(harness, thread.id));
      }
    });
  });

  it("a no-op delta (no new events) returns an empty patch and merges to the same window", async () => {
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
      const { delta, applied } = await getDelta(harness, thread.id, before);
      expect(delta).toEqual({
        afterTag: before.tag,
        upsertRows: [],
        fields: {},
      });
      expect(applied).toEqual(before);
    });
  });

  it("answers a client from before tags with the full window", async () => {
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
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline?afterSequence=${before.maxSeq}`,
      );
      expect(response.status).toBe(200);
      expect(
        threadTimelineReadResponseSchema.parse(await readJson(response)),
      ).toEqual(before);
    });
  });

  it("answers an unknown tag with the full window", async () => {
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
      const response = await readTimeline(harness, thread.id, "unknown");
      expect(isThreadTimelineDelta(response)).toBe(false);
    });
  });
});
