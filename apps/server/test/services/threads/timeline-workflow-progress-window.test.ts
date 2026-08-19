import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  LOCAL_WORKFLOW_TASK_TYPE,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { Thread } from "@bb/domain";
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
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import {
  buildThreadConversationOutline,
  buildThreadTimelineWithProfile,
  THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
} from "../../../src/services/threads/timeline.js";

/** Larger than any thread these tests build, so the event budget never binds. */
const LARGE_BUDGET = 1_000_000;
const providerThreadId = "provider-root";
const WORKFLOW_CALL_ID = "call-workflow";
const WORKFLOW_TASK_ID = "task:wf-1";
/**
 * A workflow snapshot with a couple hundred agents is ~250 KB. Enough of them
 * to span several 4 MiB byte windows.
 */
const SNAPSHOT_BYTES = 300_000;
const SNAPSHOT_COUNT = 45;

const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

type EventInput = Parameters<typeof insertEvents>[2][number];

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

function workflowTaskData(args: {
  status: "pending" | "completed";
  padding: number;
}): string {
  return JSON.stringify({
    providerThreadId,
    item: {
      type: "backgroundTask",
      id: WORKFLOW_TASK_ID,
      taskType: LOCAL_WORKFLOW_TASK_TYPE,
      description: "sweep the codebase",
      status: args.status,
      taskStatus: args.status === "pending" ? "running" : "completed",
      skipTranscript: false,
      workflowName: "sweep",
      parentToolCallId: WORKFLOW_CALL_ID,
      workflow: {
        phases: [{ index: 1, title: "Find" }],
        agents: [
          {
            index: 1,
            label: "find:boot",
            state: "running",
            model: "gpt-5",
            attempt: 1,
            cached: false,
            lastProgressAt: 1,
            promptPreview: "x".repeat(args.padding),
          },
        ],
      },
    },
  });
}

/**
 * Turn 1: user asks, agent starts a Workflow tool call (a local_workflow
 * background task), reports back, and the turn completes. The workflow keeps
 * running and streams thread-scoped progress snapshots long after turn 1
 * completed. Turn 2 is a provider-opened turn that is still pending.
 */
function seedWorkflowThread(
  db: DbConnection,
  thread: Thread,
  options: {
    /** Large completed command items in the pending turn 2. */
    pendingTurnItems?: number;
    snapshotCount: number;
  },
): void {
  const events: EventInput[] = [];
  let sequence = 0;
  const push = (event: Omit<EventInput, "sequence" | "threadId">): void => {
    sequence += 1;
    events.push({ ...event, sequence, threadId: thread.id });
  };
  const clientRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  push({
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
      input: [{ type: "text", text: "Sweep the codebase", mentions: [] }],
      target: { kind: "thread-start" },
      execution,
    }),
  });
  push({
    type: "turn/started",
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({}),
  });
  push({
    type: "turn/input/accepted",
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({ clientRequestId }),
  });
  push({
    type: "item/started",
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: WORKFLOW_CALL_ID,
    itemKind: "toolCall",
    parentToolCallId: null,
    data: JSON.stringify({
      providerThreadId,
      item: {
        type: "toolCall",
        id: WORKFLOW_CALL_ID,
        tool: "Workflow",
        arguments: { script: "export const meta = {}" },
        status: "pending",
      },
    }),
  });
  push({
    type: "item/started",
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: WORKFLOW_TASK_ID,
    itemKind: "backgroundTask",
    parentToolCallId: WORKFLOW_CALL_ID,
    data: workflowTaskData({ status: "pending", padding: 0 }),
  });
  push({
    type: "item/completed",
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: WORKFLOW_CALL_ID,
    itemKind: "toolCall",
    parentToolCallId: null,
    data: JSON.stringify({
      providerThreadId,
      item: {
        type: "toolCall",
        id: WORKFLOW_CALL_ID,
        tool: "Workflow",
        arguments: { script: "export const meta = {}" },
        result: "started",
        status: "completed",
      },
    }),
  });
  push({
    type: "item/completed",
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: "assistant-1",
    itemKind: "agentMessage",
    parentToolCallId: null,
    data: JSON.stringify({
      providerThreadId,
      item: {
        type: "agentMessage",
        id: "assistant-1",
        text: "The workflow will notify me when it completes.",
        status: "completed",
      },
    }),
  });
  push({
    type: "turn/completed",
    scope: turnScope("turn-1"),
    providerThreadId,
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({ status: "completed", providerThreadId }),
  });
  push({
    type: "turn/started",
    scope: turnScope("turn-2"),
    providerThreadId,
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({}),
  });
  for (let index = 0; index < (options.pendingTurnItems ?? 0); index += 1) {
    const itemId = `turn-2-item-${index}`;
    const command = "x".repeat(25_000);
    push({
      type: "item/started",
      scope: turnScope("turn-2"),
      providerThreadId,
      itemId,
      itemKind: "commandExecution",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "commandExecution",
          id: itemId,
          command,
          cwd: "/tmp/test",
          status: "pending",
          approvalStatus: null,
        },
      }),
    });
    push({
      type: "item/completed",
      scope: turnScope("turn-2"),
      providerThreadId,
      itemId,
      itemKind: "commandExecution",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "commandExecution",
          id: itemId,
          command,
          cwd: "/tmp/test",
          status: "completed",
          approvalStatus: null,
          exitCode: 0,
          aggregatedOutput: `output ${index}`,
        },
      }),
    });
  }
  for (let index = 0; index < options.snapshotCount; index += 1) {
    push({
      type: "item/backgroundTask/progress",
      scope: threadScope(),
      providerThreadId,
      itemId: WORKFLOW_TASK_ID,
      itemKind: "backgroundTask",
      parentToolCallId: WORKFLOW_CALL_ID,
      data: workflowTaskData({ status: "pending", padding: SNAPSHOT_BYTES }),
    });
  }
  insertEvents(db, noopNotifier, events);
}

function buildPage(
  db: DbConnection,
  thread: Thread,
  cursor: TimelinePaginationCursor | null,
  eventBudget = LARGE_BUDGET,
) {
  return buildThreadTimelineWithProfile(db, thread, {
    eventBudget,
    includeProviderUnhandledOperations: false,
    includeNestedRows: false,
    maxInlineOutputChars: 32_000,
    maxSeq: 0,
    page: cursor
      ? { kind: "older", beforeCursor: cursor, segmentLimit: 20 }
      : { kind: "latest", segmentLimit: 20 },
  });
}

interface WalkResult {
  maxEventDataBytes: number;
  pages: number;
  rows: TimelineRow[];
}

function walkAllPages(db: DbConnection, thread: Thread): WalkResult {
  const rowsByPage: TimelineRow[][] = [];
  let cursor: TimelinePaginationCursor | null = null;
  let maxEventDataBytes = 0;
  let pages = 0;
  for (;;) {
    const { profile, response } = buildPage(db, thread, cursor);
    pages += 1;
    maxEventDataBytes = Math.max(maxEventDataBytes, profile.eventDataBytes);
    rowsByPage.push(response.rows);
    if (!response.timelinePage.hasOlderRows) {
      break;
    }
    cursor = response.timelinePage.olderCursor;
    expect(cursor).not.toBeNull();
    expect(pages).toBeLessThan(50);
  }
  return { maxEventDataBytes, pages, rows: rowsByPage.reverse().flat() };
}

describe("workflow progress snapshots across timeline pages", () => {
  it("renders the spawning turn's summary once, not once per byte page", () => {
    const { db, thread } = setup();
    seedWorkflowThread(db, thread, { snapshotCount: SNAPSHOT_COUNT });
    expect(SNAPSHOT_BYTES * SNAPSHOT_COUNT).toBeGreaterThan(
      THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT * 2,
    );

    const walk = walkAllPages(db, thread);
    const turnRows = walk.rows.filter(
      (row): row is Extract<TimelineRow, { kind: "turn" }> =>
        row.kind === "turn",
    );
    const turnOneRows = turnRows.filter((row) => row.turnId === "turn-1");

    // One finished turn, one "Worked for" row — whatever the paging did.
    expect(turnOneRows.map((row) => row.id)).toHaveLength(1);
    // And no page ever emits a finished-turn row that lies entirely outside
    // the events that page actually covers.
    expect(new Set(turnRows.map((row) => row.id)).size).toBe(turnRows.length);
  });

  it("does not emit the spawning turn's summary on byte pages of a later turn", () => {
    const { db, thread } = setup();
    // Turn 2 is pending and large enough to page by bytes. The workflow's
    // single latest snapshot sits at the tail, so the latest page carries it
    // (and its parentToolCallId, which names the Workflow call in turn 1).
    seedWorkflowThread(db, thread, { pendingTurnItems: 250, snapshotCount: 1 });

    const walk = walkAllPages(db, thread);
    expect(walk.pages).toBeGreaterThan(2);
    const turnOneRows = walk.rows.filter(
      (row) => row.kind === "turn" && row.turnId === "turn-1",
    );
    expect(turnOneRows.map((row) => row.id)).toHaveLength(1);
    // The one summary is on the page that holds turn 1's own events.
    expect(turnOneRows[0]?.sourceSeqStart).toBeLessThan(10);
    // Turn 2 is pending: no summary row for it, only its command rows.
    expect(
      walk.rows.filter((row) => row.kind === "turn" && row.turnId === "turn-2"),
    ).toHaveLength(0);
    // The workflow banner still comes from the latest snapshot.
    const latest = buildPage(db, thread, null);
    expect(latest.response.activeWorkflows).toHaveLength(1);
  }, 15_000);

  it("does not spend the byte budget on superseded progress snapshots", () => {
    const { db, thread } = setup();
    seedWorkflowThread(db, thread, { snapshotCount: SNAPSHOT_COUNT });

    const latest = buildPage(db, thread, null);
    // Only the latest snapshot per task is load-bearing (see
    // pruneBackgroundTaskProgressEvents), so the whole thread fits one page.
    expect(latest.response.timelinePage.hasOlderRows).toBe(false);
    expect(latest.profile.eventDataBytes).toBeLessThan(SNAPSHOT_BYTES * 3);
    expect(latest.response.activeWorkflows).toHaveLength(1);
    expect(
      latest.response.rows.filter((row) => row.kind === "turn"),
    ).toHaveLength(1);

    // The event-count budget counts the same rows. The thread has ~15 live
    // events, so a budget of 30 binds only if the 45 superseded snapshots are
    // counted.
    const eventBudgeted = buildPage(db, thread, null, 30);
    expect(eventBudgeted.response.timelinePage.hasOlderRows).toBe(false);
    expect(eventBudgeted.response.rows).toEqual(latest.response.rows);

    // The conversation outline reads the task's structural rows too; it must
    // not decode every old snapshot to list two messages.
    const outline = buildThreadConversationOutline(db, thread, { maxSeq: 0 });
    expect(outline.items.map((item) => item.role)).toEqual([
      "user",
      "assistant",
    ]);
  });
});
