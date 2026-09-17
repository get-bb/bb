import { describe, expect, it } from "vitest";
import {
  buildLoadedTimelineState,
  mergeLoadedTimelineWithLatest,
  prependOlderTimelineRows,
  resolveLoadedTimelineSurfaceKey,
} from "@bb/client-core";
import {
  defaultAppSettings,
  defaultFeatureFlags,
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type AppSettings,
} from "@bb/domain";
import {
  threadConversationOutlineResponseSchema,
  threadTimelineResponseSchema,
  timelineTurnSummaryDetailsResponseSchema,
  type TimelinePaginationCursor,
  type TimelineRow,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

function seedFinishedTurnThread(
  harness: TestAppHarness,
  providerId: string,
): string {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId },
  });
  const scope = {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "p1",
    scope: turnScope("turn-1"),
  } as const;
  const events: [
    "turn/started" | "item/completed" | "turn/completed",
    Record<string, unknown>,
  ][] = [
    ["turn/started", {}],
    [
      "item/completed",
      {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Let me read the entry point.",
        },
      },
    ],
    [
      "item/completed",
      {
        item: {
          type: "toolCall",
          id: "tool-1",
          tool: "read",
          status: "completed",
          result: "ok",
        },
      },
    ],
    [
      "item/completed",
      {
        item: {
          type: "agentMessage",
          id: "assistant-2",
          text: "The entry point wires the daemon.",
        },
      },
    ],
    ["turn/completed", { status: "completed" }],
  ];
  events.forEach(([type, data], index) => {
    seedEvent(harness.deps, { ...scope, sequence: index + 1, type, data });
  });
  return thread.id;
}

function rowSignature(row: TimelineRow): string {
  if (row.kind === "conversation") return `conversation:${row.role}`;
  if (row.kind === "work") return `work:${row.workKind}`;
  return row.kind;
}

async function getTimeline(harness: TestAppHarness, threadId: string) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

async function getOutlinePreviews(harness: TestAppHarness, threadId: string) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/conversation-outline`,
  );
  expect(response.status).toBe(200);
  return threadConversationOutlineResponseSchema
    .parse(await readJson(response))
    .items.map((item) => item.preview);
}

async function putGeneralSettings(
  harness: TestAppHarness,
  settings: AppSettings,
): Promise<void> {
  const response = await harness.app.request("/api/v1/settings/general", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  expect(response.status).toBe(200);
}

describe("finished turn display per provider", () => {
  it("renders a provider's finished turns with its declared default", async () => {
    await withTestHarness(async (harness) => {
      const claudeThreadId = seedFinishedTurnThread(harness, "claude-code");
      const codexThreadId = seedFinishedTurnThread(harness, "codex");

      const claude = await getTimeline(harness, claudeThreadId);
      const codex = await getTimeline(harness, codexThreadId);

      expect(claude.rows.map(rowSignature)).toEqual([
        "conversation:assistant",
        "work:tool",
        "conversation:assistant",
      ]);
      expect(codex.rows.map(rowSignature)).toEqual([
        "turn",
        "conversation:assistant",
      ]);
    });
  });

  it("applies the user's per-provider setting to the timeline, turn details, and outline at the same sequence", async () => {
    await withTestHarness(async (harness) => {
      const threadId = seedFinishedTurnThread(harness, "claude-code");

      const flat = await getTimeline(harness, threadId);
      expect(flat.rows.some((row) => row.kind === "turn")).toBe(false);
      expect(await getOutlinePreviews(harness, threadId)).toEqual([
        "Let me read the entry point.",
        "The entry point wires the daemon.",
      ]);

      await putGeneralSettings(harness, {
        ...defaultAppSettings,
        providerCompletedTurnDisplay: { "claude-code": "collapse" },
      });

      const collapsed = await getTimeline(harness, threadId);
      expect(collapsed.maxSeq).toBe(flat.maxSeq);
      expect(collapsed.rows.map(rowSignature)).toEqual([
        "turn",
        "conversation:assistant",
      ]);
      const turnRow = collapsed.rows.find((row) => row.kind === "turn");
      if (turnRow?.kind !== "turn") throw new Error("turn row missing");
      const detailsResponse = await harness.app.request(
        `/api/v1/threads/${threadId}/timeline/turn-summary-details?turnId=${turnRow.turnId}&sourceSeqStart=${turnRow.sourceSeqStart}&sourceSeqEnd=${turnRow.sourceSeqEnd}`,
      );
      expect(detailsResponse.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(detailsResponse),
      );
      expect(details.rows.map(rowSignature)).toEqual([
        "conversation:assistant",
        "work:tool",
      ]);
      expect(await getOutlinePreviews(harness, threadId)).toEqual([
        "The entry point wires the daemon.",
      ]);

      await putGeneralSettings(harness, defaultAppSettings);

      const restored = await getTimeline(harness, threadId);
      expect(restored.rows.map(rowSignature)).toEqual(
        flat.rows.map(rowSignature),
      );
    });
  });
});

function seedPagedFinishedTurns(
  harness: TestAppHarness,
  turnCount: number,
): string {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: "claude-code" },
  });
  let sequence = 0;
  const seed = (
    type: Parameters<typeof seedEvent>[1]["type"],
    scope: ReturnType<typeof turnScope> | ReturnType<typeof threadScope>,
    data: Record<string, unknown>,
  ) => {
    sequence += 1;
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "p1",
      scope,
      sequence,
      type,
      data,
    });
  };
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const turnId = `turn-${turn}`;
    const clientRequestId = encodeClientTurnRequestIdNumber({ value: turn });
    seed("client/turn/requested", threadScope(), {
      direction: "outbound",
      source: "tell",
      initiator: "user",
      request: { method: "turn/start", params: {} },
      requestId: clientRequestId,
      senderThreadId: null,
      input: [{ type: "text", text: `User message ${turn}`, mentions: [] }],
      target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
      execution: {
        model: "claude-opus",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    });
    seed("turn/started", turnScope(turnId), {});
    seed("turn/input/accepted", turnScope(turnId), { clientRequestId });
    seed("item/completed", turnScope(turnId), {
      item: {
        type: "agentMessage",
        id: `${turnId}-narration`,
        text: `Let me check turn ${turn}.`,
      },
    });
    seed("item/completed", turnScope(turnId), {
      item: {
        type: "toolCall",
        id: `${turnId}-tool`,
        tool: "read",
        status: "completed",
        result: "ok",
      },
    });
    seed("item/completed", turnScope(turnId), {
      item: {
        type: "agentMessage",
        id: `${turnId}-answer`,
        text: `Turn ${turn} is done.`,
      },
    });
    seed("turn/completed", turnScope(turnId), { status: "completed" });
  }
  return thread.id;
}

async function readTimelinePage(
  harness: TestAppHarness,
  threadId: string,
  cursor: TimelinePaginationCursor | null,
) {
  const query =
    cursor === null
      ? ""
      : new URLSearchParams({
          beforeAnchorSeq: String(cursor.anchorSeq),
          beforeAnchorId: cursor.anchorId,
        }).toString();
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline?segmentLimit=1&${query}`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

async function loadOlderPages(
  harness: TestAppHarness,
  threadId: string,
  loadedRows: TimelineRow[],
  cursor: TimelinePaginationCursor | null,
) {
  let rows = loadedRows;
  let next = cursor;
  let pages = 0;
  while (next !== null) {
    const older = await readTimelinePage(harness, threadId, next);
    rows = prependOlderTimelineRows({
      olderRows: older.rows,
      loadedRows: rows,
    });
    next = older.timelinePage.olderCursor;
    pages += 1;
    expect(pages).toBeLessThan(50);
  }
  return { pages, rows };
}

describe("finished turn display across loaded pages", () => {
  it("drops pages loaded under the old display and reloads them under the new one", async () => {
    await withTestHarness(
      {
        featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 5 },
      },
      async (harness) => {
        const threadId = seedPagedFinishedTurns(harness, 4);
        const flatLatest = await readTimelinePage(harness, threadId, null);
        const flat = await loadOlderPages(
          harness,
          threadId,
          flatLatest.rows,
          flatLatest.timelinePage.olderCursor,
        );
        expect(flat.pages).toBeGreaterThan(0);
        expect(flat.rows.some((row) => row.kind === "turn")).toBe(false);
        const loaded = buildLoadedTimelineState({
          historySnapshot: flatLatest.timelinePage.historySnapshot,
          latestRows: flat.rows,
          latestWindowEndSequence: flatLatest.maxSeq,
          olderCursor: null,
          surfaceKey: resolveLoadedTimelineSurfaceKey(threadId, flatLatest),
        });

        await putGeneralSettings(harness, {
          ...defaultAppSettings,
          providerCompletedTurnDisplay: { "claude-code": "collapse" },
        });
        const collapsedLatest = await readTimelinePage(harness, threadId, null);
        expect(collapsedLatest.maxSeq).toBe(flatLatest.maxSeq);

        const merged = mergeLoadedTimelineWithLatest({
          current: loaded,
          latestTimeline: collapsedLatest,
          surfaceKey: resolveLoadedTimelineSurfaceKey(
            threadId,
            collapsedLatest,
          ),
        });
        expect(merged.rows.map((row) => row.id)).toEqual(
          collapsedLatest.rows.map((row) => row.id),
        );
        expect(merged.olderCursor).toEqual(
          collapsedLatest.timelinePage.olderCursor,
        );

        const reloaded = await loadOlderPages(
          harness,
          threadId,
          merged.rows,
          merged.olderCursor,
        );
        const canonical = await loadOlderPages(
          harness,
          threadId,
          collapsedLatest.rows,
          collapsedLatest.timelinePage.olderCursor,
        );
        expect(reloaded.rows.map((row) => row.id)).toEqual(
          canonical.rows.map((row) => row.id),
        );
        expect(reloaded.rows.filter((row) => row.kind === "turn")).toHaveLength(
          4,
        );
      },
    );
  });
});
