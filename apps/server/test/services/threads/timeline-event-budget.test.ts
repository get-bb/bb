import { describe, expect, it } from "vitest";
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
import { buildThreadTimeline } from "../../../src/services/threads/timeline.js";

/** Larger than any thread these tests build, so the budget never binds. */
const LARGE_BUDGET = 1_000_000;

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

function setup(): { db: DbConnection; thread: Thread } {
  const db = createConnection(":memory:");
  migrate(db);
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

/**
 * Builds `turnCount` turns, each a user message followed by `itemsPerTurn`
 * completed items — the "few user messages, many events" shape that defeats
 * segment-only windowing.
 */
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

interface WalkResult {
  pages: number;
  userMessages: string[];
}

/** Walks every page oldest-ward, collecting the user messages it can reach. */
function walkAllPages(
  db: DbConnection,
  thread: Thread,
  eventBudget: number,
): WalkResult {
  // Per page, oldest-first within the page. Pages arrive newest-first, so the
  // page list (not the flattened list) is what gets reversed at the end.
  const messagesByPage: string[][] = [];
  const seenCursors = new Set<string>();
  let cursor: TimelinePaginationCursor | null = null;
  let pages = 0;

  for (;;) {
    const response = buildThreadTimeline(db, thread, {
      eventBudget,
      includeProviderUnhandledOperations: false,
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
  it("reaches every user message that the unbudgeted build reaches", () => {
    const { db, thread } = setup();
    // 12 turns × ~60 events: far below `segmentLimit` in turns, far above any
    // sane event budget in work.
    insertTurns(db, thread, 12, 60);

    const unbudgeted = walkAllPages(db, thread, LARGE_BUDGET);
    const budgeted = walkAllPages(db, thread, 150);

    expect(budgeted.userMessages).toEqual(unbudgeted.userMessages);
    expect(budgeted.userMessages).toHaveLength(12);
    // The budget is what forces pagination; without it this is a single page.
    expect(unbudgeted.pages).toBe(1);
    expect(budgeted.pages).toBeGreaterThan(1);
  });

  it("reports older rows when the budget truncates a window that fits in segmentLimit", () => {
    const { db, thread } = setup();
    insertTurns(db, thread, 8, 40);

    // Segment-only windowing sees 8 turns ≤ segmentLimit 20 and declares the
    // thread fully loaded. The budget must not inherit that: dropping segments
    // for cost while still reporting `hasOlderRows: false` would make the
    // older history permanently unreachable.
    const unbudgeted = buildThreadTimeline(db, thread, {
      eventBudget: LARGE_BUDGET,
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });
    expect(unbudgeted.timelinePage.hasOlderRows).toBe(false);

    const budgeted = buildThreadTimeline(db, thread, {
      eventBudget: 100,
      includeProviderUnhandledOperations: false,
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
    // One turn of 400 events against a budget of 50: the window cannot be
    // shrunk below one segment without showing an empty thread.
    insertTurns(db, thread, 3, [10, 400, 10]);

    const budgeted = buildThreadTimeline(db, thread, {
      eventBudget: 50,
      includeProviderUnhandledOperations: false,
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

  it("leaves a thread that fits inside the budget byte-identical", () => {
    const { db, thread } = setup();
    insertTurns(db, thread, 4, 5);

    const page = { kind: "latest", segmentLimit: 20 } as const;
    const options = {
      includeProviderUnhandledOperations: false,
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
