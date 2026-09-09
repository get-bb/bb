import { describe, expect, it } from "vitest";
import { getTimelineGroupingContext } from "../../../src/services/threads/timeline-context-order.js";
import { prependOlderTimelineRows } from "@bb/client-core";
import {
  threadTimelineResponseSchema,
  type TimelineRow,
} from "@bb/server-contract";
import { defaultFeatureFlags } from "@bb/domain";
import { createTestAppHarness } from "../../helpers/test-app.js";
import {
  mergeLoadedTimelineWithLatest,
  buildLoadedTimelineState,
} from "@bb/client-core";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { ClientTurnRequestId, Thread } from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import type { TimelinePaginationCursor } from "@bb/server-contract";
import {
  buildThreadTimeline,
  buildThreadTimelineWithProfile,
} from "../../../src/services/threads/timeline.js";

const LARGE_BUDGET = 1_000_000;

it.each([
  { ends: [30], accepted: 0, boundary: null },
  { ends: [30], accepted: -1, boundary: 15 },
  { ends: [30, 20], accepted: 0, boundary: 15 },
  { ends: [30, 10], accepted: 0, boundary: null },
  { ends: [10, 12], accepted: -1, boundary: null },
  { ends: [20, 30], accepted: 1, boundary: 15 },
])("finds external requests among overlapping turns: %j", (testCase) => {
  const { db, thread } = setup();
  try {
    const events: Parameters<typeof insertEvents>[2] = [];
    for (const [index, end] of testCase.ends.entries()) {
      const scope = turnScope(`span-${index}`);
      const base = {
        threadId: thread.id,
        scope,
        providerThreadId,
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
      };
      events.push(
        { ...base, sequence: index * 2 + 1, type: "turn/started", data: "{}" },
        { ...base, sequence: end, type: "turn/completed", data: "{}" },
      );
      if (index === testCase.accepted)
        events.push({
          ...base,
          sequence: index * 2 + 2,
          type: "turn/input/accepted",
          data: JSON.stringify({ clientRequestId: requestId(1) }),
        });
    }
    events.push({
      threadId: thread.id,
      scope: threadScope(),
      sequence: 15,
      type: "client/turn/requested",
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ requestId: requestId(1), initiator: "user" }),
    });
    insertEvents(
      db,
      noopNotifier,
      events.sort((a, b) => a.sequence - b.sequence),
    );
    expect(
      getTimelineGroupingContext(db, {
        threadId: thread.id,
        sequenceStart: 0,
        maxSeq: 30,
      }).orderingBoundarySequence,
    ).toBe(testCase.boundary);
  } finally {
    db.$client.close();
  }
});

const providerThreadId = "provider-root";
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

function requestId(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

function setup(connection?: DbConnection): {
  db: DbConnection;
  thread: Thread;
} {
  const db = connection ?? createConnection(":memory:");
  if (connection === undefined) migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "claude-code",
  });
  return { db, thread };
}

function insertTurns(
  db: DbConnection,
  thread: Thread,
  turnCount: number,
  itemsPerTurn: readonly number[] | number,
): void {
  const events: Parameters<typeof insertEvents>[2] = [];
  let sequence = 0;
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const turnId = `turn-${turn}`;
    const clientRequestId = requestId(turn);
    sequence += 1;
    events.push({
      threadId: thread.id,
      sequence,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: `User message ${turn}`, mentions: [] }],
        target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution,
      }),
    });
    sequence += 1;
    events.push({
      threadId: thread.id,
      sequence,
      type: "turn/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({}),
    });
    sequence += 1;
    events.push({
      threadId: thread.id,
      sequence,
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ clientRequestId }),
    });
    const items =
      typeof itemsPerTurn === "number"
        ? itemsPerTurn
        : (itemsPerTurn[turn - 1] ?? 1);
    for (let item = 0; item < items; item += 1) {
      sequence += 1;
      events.push({
        threadId: thread.id,
        sequence,
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: `${turnId}-item-${item}`,
        itemKind: "agentMessage",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `${turnId}-item-${item}`,
            text: `Turn ${turn} item ${item}`,
          },
        }),
      });
    }
  }
  insertEvents(db, noopNotifier, events);
}

function insertTurnsWithReusedFileChangeItemId(
  db: DbConnection,
  thread: Thread,
  turnCount: number,
  fillerItemsPerTurn: number,
): void {
  const reusedItemId = "acp-fs-write-1";
  const events: Parameters<typeof insertEvents>[2] = [];
  let sequence = 0;
  const push = (
    event: Omit<Parameters<typeof insertEvents>[2][number], "sequence">,
  ): void => {
    sequence += 1;
    events.push({ ...event, sequence });
  };

  for (let turn = 1; turn <= turnCount; turn += 1) {
    const turnId = `turn-${turn}`;
    const clientRequestId = requestId(turn);
    push({
      threadId: thread.id,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: `User message ${turn}`, mentions: [] }],
        target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution,
      }),
    });
    push({
      threadId: thread.id,
      type: "turn/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({}),
    });
    push({
      threadId: thread.id,
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ clientRequestId }),
    });
    for (let item = 0; item < fillerItemsPerTurn; item += 1) {
      push({
        threadId: thread.id,
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: `${turnId}-item-${item}`,
        itemKind: "agentMessage",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `${turnId}-item-${item}`,
            text: `Turn ${turn} item ${item}`,
          },
        }),
      });
    }
    const changes = [
      {
        path: "src/a.ts",
        kind: "update",
        diff: `@@ -1 +1 @@\n-old\n+${turnId}`,
      },
    ];
    for (const type of ["item/started", "item/completed"] as const) {
      push({
        threadId: thread.id,
        type,
        scope: turnScope(turnId),
        providerThreadId,
        itemId: reusedItemId,
        itemKind: "fileChange",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "fileChange",
            id: reusedItemId,
            changes,
            status: type === "item/completed" ? "completed" : "pending",
            approvalStatus: null,
          },
        }),
      });
    }
  }
  insertEvents(db, noopNotifier, events);
}

function walkAllFileChangeDiffs(
  db: DbConnection,
  thread: Thread,
  eventBudget: number,
): string[] {
  const diffsByPage: string[][] = [];
  let cursor: TimelinePaginationCursor | null = null;
  for (let page = 0; page < 200; page += 1) {
    const response = buildThreadTimeline(db, thread, {
      eventBudget,
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page: cursor
        ? { kind: "older", beforeCursor: cursor, segmentLimit: 20 }
        : { kind: "latest", segmentLimit: 20 },
    });
    diffsByPage.push(
      response.rows
        .filter((row) => row.kind === "work" && row.workKind === "file-change")
        .map((row) =>
          row.kind === "work" && row.workKind === "file-change"
            ? (row.change.diff ?? "")
            : "",
        ),
    );
    if (!response.timelinePage.hasOlderRows) {
      break;
    }
    cursor = response.timelinePage.olderCursor;
    expect(cursor).not.toBeNull();
  }
  return diffsByPage.reverse().flat();
}

interface WalkResult {
  pages: number;
  userMessages: string[];
}

function walkAllPages(
  db: DbConnection,
  thread: Thread,
  eventBudget: number,
): WalkResult {
  const messagesByPage: string[][] = [];
  const seenCursors = new Set<string>();
  let cursor: TimelinePaginationCursor | null = null;
  let pages = 0;

  for (;;) {
    const response = buildThreadTimeline(db, thread, {
      eventBudget,
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page: cursor
        ? { kind: "older", beforeCursor: cursor, segmentLimit: 20 }
        : { kind: "latest", segmentLimit: 20 },
    });
    pages += 1;
    messagesByPage.push(
      response.rows
        .filter((row) => row.kind === "conversation" && row.role === "user")
        .map((row) => row.id),
    );
    if (!response.timelinePage.hasOlderRows) {
      break;
    }
    const next = response.timelinePage.olderCursor;
    expect(
      next,
      `page ${pages} reported older rows but no cursor`,
    ).not.toBeNull();
    const key = `${next!.anchorSeq}:${next!.anchorId}`;
    expect(seenCursors.has(key), `cursor loop at ${key}`).toBe(false);
    seenCursors.add(key);
    cursor = next;
    expect(pages).toBeLessThan(200);
  }
  return { pages, userMessages: messagesByPage.reverse().flat() };
}

describe("timeline event budget", () => {
  it("preserves canonical rows through the client merge with tiny event windows", () => {
    const { db, thread } = setup();
    insertTurns(db, thread, 3, [10, 400, 10]);
    const options = {
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
    } as const;
    const canonical = buildThreadTimeline(db, thread, {
      ...options,
      eventBudget: LARGE_BUDGET,
      page: { kind: "latest", segmentLimit: 100 },
    });
    let rows: TimelineRow[] = [];
    let cursor: TimelinePaginationCursor | null = null;
    for (let index = 0; index < 200; index += 1) {
      const response = buildThreadTimeline(db, thread, {
        ...options,
        eventBudget: 5,
        page: cursor
          ? { kind: "older", beforeCursor: cursor, segmentLimit: 1 }
          : { kind: "latest", segmentLimit: 1 },
      });
      rows = prependOlderTimelineRows({
        loadedRows: rows,
        olderRows: response.rows,
      });
      cursor = response.timelinePage.olderCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(rows).toEqual(canonical.rows);
    db.$client.close();
  });

  it("excludes later appends and continues endpoint pagination after an edit", async () => {
    const harness = await createTestAppHarness({
      featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 5 },
    });
    try {
      const { db, thread } = setup(harness.db);
      insertTurns(db, thread, 3, [10, 40, 10]);
      const read = async (query: string) => {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/timeline?includeNestedRows=true&segmentLimit=1&${query}`,
        );
        expect(response.status).toBe(200);
        return threadTimelineResponseSchema.parse(await response.json());
      };
      const expected = buildThreadTimeline(db, thread, {
        includeDiagnosticOperations: false,
        includeNestedRows: true,
        maxInlineOutputChars: 32_000,
        maxSeq: 0,
        eventBudget: LARGE_BUDGET,
        page: { kind: "latest", segmentLimit: 100 },
      }).rows;
      const latest = await read("");
      const originalCursor = latest.timelinePage.olderCursor!;
      insertEvents(db, noopNotifier, [
        {
          threadId: thread.id,
          sequence: latest.maxSeq + 1,
          type: "item/completed",
          scope: turnScope("turn-1"),
          providerThreadId,
          itemId: "late-response",
          itemKind: "agentMessage",
          parentToolCallId: null,
          data: JSON.stringify({
            item: {
              type: "agentMessage",
              id: "late-response",
              text: "A late response",
            },
          }),
        },
      ]);
      let rows = latest.rows;
      let cursor: TimelinePaginationCursor | null = originalCursor;
      let pages = 1;
      while (cursor) {
        const older = await read(
          new URLSearchParams({
            beforeAnchorSeq: String(cursor.anchorSeq),
            beforeAnchorId: cursor.anchorId,
          }).toString(),
        );
        expect(older.maxSeq).toBe(latest.maxSeq);
        expect(older.timelinePage.historySnapshot).toBe(
          latest.timelinePage.historySnapshot,
        );
        rows = prependOlderTimelineRows({
          olderRows: older.rows,
          loadedRows: rows,
        });
        cursor = older.timelinePage.olderCursor;
        expect(++pages).toBeLessThan(100);
      }
      expect(rows).toEqual(expected);
      expect(pages).toBeGreaterThan(3);
      const current = buildLoadedTimelineState({
        latestWindowEndSequence: latest.maxSeq,
        latestRows: rows,
        olderCursor: null,
        surfaceKey: thread.id,
        historySnapshot: latest.timelinePage.historySnapshot,
      });
      const live = await read("");
      expect(
        mergeLoadedTimelineWithLatest({
          current,
          latestTimeline: live,
          surfaceKey: thread.id,
        }).rows,
      ).toEqual(live.rows);
      db.$client
        .prepare(
          "UPDATE events SET data = json_set(data, '$.item.text', 'Edited response') WHERE thread_id = ? AND item_id = ?",
        )
        .run(thread.id, "turn-1-item-0");
      const stale = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline?includeNestedRows=true&${new URLSearchParams({ beforeAnchorSeq: String(originalCursor.anchorSeq), beforeAnchorId: originalCursor.anchorId })}`,
      );
      expect(stale.status).toBe(200);
      const continued = threadTimelineResponseSchema.parse(await stale.json());
      expect(continued.timelinePage.historySnapshot).toBe(
        latest.timelinePage.historySnapshot,
      );
      db.$client
        .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = ?")
        .run(thread.id, originalCursor.anchorSeq);
      const missingAnchor = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline?includeNestedRows=true&segmentLimit=2&${new URLSearchParams({ beforeAnchorSeq: String(originalCursor.anchorSeq), beforeAnchorId: originalCursor.anchorId })}`,
      );
      expect(missingAnchor.status).toBe(400);
      expect(await missingAnchor.text()).toContain("no longer available");
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves canonical content under a tiny response byte budget", () => {
    const { db, thread } = setup();
    try {
      insertTurns(db, thread, 3, [2, 30, 2]);
      const options = {
        includeDiagnosticOperations: false,
        includeNestedRows: true,
        maxInlineOutputChars: null,
        maxSeq: 0,
        eventBudget: LARGE_BUDGET,
      } as const;
      const canonical = buildThreadTimeline(db, thread, {
        ...options,
        page: { kind: "latest", segmentLimit: 100 },
      });
      let rows: TimelineRow[] = [];
      let cursor: TimelinePaginationCursor | null = null;
      let pages = 0;
      do {
        const response = buildThreadTimeline(db, thread, {
          ...options,
          responseByteBudget: 512,
          page: cursor
            ? { kind: "older", beforeCursor: cursor, segmentLimit: 2 }
            : { kind: "latest", segmentLimit: 2 },
        });
        rows = prependOlderTimelineRows({
          loadedRows: rows,
          olderRows: response.rows,
        });
        cursor = response.timelinePage.olderCursor;
        expect(++pages).toBeLessThan(100);
      } while (cursor);
      expect(rows).toEqual(canonical.rows);
      expect(pages).toBeGreaterThan(3);
    } finally {
      db.$client.close();
    }
  });

  it("continues after suffix replacement but rejects a deleted cursor anchor", () => {
    const { db, thread } = setup();
    try {
      insertTurns(db, thread, 3, 2);
      const options = {
        includeDiagnosticOperations: false,
        includeNestedRows: true,
        maxInlineOutputChars: null,
        maxSeq: 0,
        eventBudget: 1,
      } as const;
      const latest = buildThreadTimeline(db, thread, {
        ...options,
        page: { kind: "latest", segmentLimit: 1 },
      });
      const beforeCursor = latest.timelinePage.olderCursor!;
      const copy = createConnection(db.$client.serialize());
      try {
        expect(
          buildThreadTimeline(copy, thread, {
            ...options,
            page: { kind: "older", beforeCursor, segmentLimit: 1 },
          }).timelinePage.historySnapshot,
        ).toBe(latest.timelinePage.historySnapshot);
      } finally {
        copy.$client.close();
      }
      db.$client
        .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = ?")
        .run(thread.id, latest.maxSeq);
      insertEvents(db, noopNotifier, [
        {
          threadId: thread.id,
          sequence: latest.maxSeq,
          type: "item/completed",
          scope: turnScope("turn-3"),
          providerThreadId,
          itemId: "replacement",
          itemKind: "agentMessage",
          parentToolCallId: null,
          data: JSON.stringify({
            item: {
              type: "agentMessage",
              id: "replacement",
              text: "Replacement",
            },
          }),
        },
      ]);
      const continued = buildThreadTimeline(db, thread, {
        ...options,
        page: { kind: "older", beforeCursor, segmentLimit: 1 },
      });
      expect(continued.timelinePage.historySnapshot).toBe(
        latest.timelinePage.historySnapshot,
      );
      db.$client
        .prepare("DELETE FROM events WHERE thread_id = ? AND sequence >= ?")
        .run(thread.id, beforeCursor.anchorSeq);
      expect(() =>
        buildThreadTimeline(db, thread, {
          ...options,
          page: { kind: "older", beforeCursor, segmentLimit: 1 },
        }),
      ).toThrow(/no longer available/);
    } finally {
      db.$client.close();
    }
  });

  it("reaches every user message that the unbudgeted build reaches", () => {
    const { db, thread } = setup();
    insertTurns(db, thread, 12, 60);

    const unbudgeted = walkAllPages(db, thread, LARGE_BUDGET);
    const budgeted = walkAllPages(db, thread, 150);

    expect(budgeted.userMessages).toEqual(unbudgeted.userMessages);
    expect(budgeted.userMessages).toHaveLength(12);
    expect(unbudgeted.pages).toBe(1);
    expect(budgeted.pages).toBeGreaterThan(1);
  });

  it("reports older rows when the budget truncates a window that fits in segmentLimit", () => {
    const { db, thread } = setup();
    insertTurns(db, thread, 8, 40);

    const unbudgeted = buildThreadTimeline(db, thread, {
      eventBudget: LARGE_BUDGET,
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });
    expect(unbudgeted.timelinePage.hasOlderRows).toBe(false);

    const budgeted = buildThreadTimeline(db, thread, {
      eventBudget: 100,
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });
    expect(budgeted.timelinePage.returnedSegmentCount).toBeLessThan(
      unbudgeted.timelinePage.returnedSegmentCount,
    );
    expect(budgeted.timelinePage.hasOlderRows).toBe(true);
    expect(budgeted.timelinePage.olderCursor).not.toBeNull();
  });

  it("still renders a single turn larger than the whole budget", () => {
    const { db, thread } = setup();
    insertTurns(db, thread, 3, [10, 400, 10]);

    const budgeted = buildThreadTimeline(db, thread, {
      eventBudget: 50,
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });
    expect(budgeted.timelinePage.returnedSegmentCount).toBeGreaterThanOrEqual(
      1,
    );
    expect(budgeted.rows.length).toBeGreaterThan(0);

    expect(walkAllPages(db, thread, 50).userMessages).toEqual(
      walkAllPages(db, thread, LARGE_BUDGET).userMessages,
    );
  });

  it("keeps one file change per turn when turns reuse a file-change item id", () => {
    const { db, thread } = setup();
    insertTurnsWithReusedFileChangeItemId(db, thread, 3, 8);

    const unbudgeted = walkAllFileChangeDiffs(db, thread, LARGE_BUDGET);
    expect(unbudgeted).toEqual([
      "@@ -1 +1 @@\n-old\n+turn-1",
      "@@ -1 +1 @@\n-old\n+turn-2",
      "@@ -1 +1 @@\n-old\n+turn-3",
    ]);
    expect(walkAllFileChangeDiffs(db, thread, 10)).toEqual(unbudgeted);
  });

  it("leaves a thread that fits inside the budget byte-identical", () => {
    const { db, thread } = setup();
    insertTurns(db, thread, 4, 5);

    const page = { kind: "latest", segmentLimit: 20 } as const;
    const options = {
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page,
    };
    expect(
      buildThreadTimeline(db, thread, { ...options, eventBudget: 1_500 }),
    ).toEqual(
      buildThreadTimeline(db, thread, {
        ...options,
        eventBudget: LARGE_BUDGET,
      }),
    );
  });
});

it("does not decode unrelated turn history for a one-group page", () => {
  const { db, thread } = setup();
  insertTurns(db, thread, 200, 3);
  const { response, profile } = buildThreadTimelineWithProfile(db, thread, {
    eventBudget: 1500,
    includeDiagnosticOperations: false,
    maxInlineOutputChars: 32000,
    maxSeq: 0,
    page: { kind: "latest", segmentLimit: 1 },
  });
  expect(
    response.rows.some(
      (row) =>
        row.kind === "conversation" &&
        row.role === "user" &&
        row.text === "User message 200",
    ),
  ).toBe(true);
  expect(profile.decodedEventCount).toBeLessThan(20);
  db.$client.close();
});

it("resolves acceptance after the next conversation boundary", () => {
  const { db, thread } = setup();
  insertTurns(db, thread, 3, 1);
  db.$client
    .prepare(
      "UPDATE events SET sequence = sequence + 1000 WHERE thread_id = ? AND turn_id = 'turn-1'",
    )
    .run(thread.id);
  const expected = buildThreadTimeline(db, thread, {
    eventBudget: LARGE_BUDGET,
    includeDiagnosticOperations: false,
    maxInlineOutputChars: 32000,
    maxSeq: 0,
    page: { kind: "latest", segmentLimit: 100 },
  });
  let page = buildThreadTimeline(db, thread, {
    eventBudget: 5,
    includeDiagnosticOperations: false,
    maxInlineOutputChars: 32000,
    maxSeq: 0,
    page: { kind: "latest", segmentLimit: 1 },
  });
  let rows = page.rows;
  for (let count = 0; page.timelinePage.olderCursor !== null; count++) {
    expect(count).toBeLessThan(20);
    page = buildThreadTimeline(db, thread, {
      eventBudget: 5,
      includeDiagnosticOperations: false,
      maxInlineOutputChars: 32000,
      maxSeq: 0,
      page: {
        kind: "older",
        segmentLimit: 1,
        beforeCursor: page.timelinePage.olderCursor,
      },
    });
    rows = prependOlderTimelineRows({ loadedRows: rows, olderRows: page.rows });
  }
  expect(rows).toEqual(expected.rows);
  db.$client.close();
});
