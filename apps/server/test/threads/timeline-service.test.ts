import { afterEach, describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import type { StoredThreadEventDataForType, Thread } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import { createTestAppHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedEvent,
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  buildThreadTimeline as buildThreadTimelineWithResolvedMode,
  buildTimelineTurnSummaryDetails as buildTimelineTurnSummaryDetailsWithResolvedMode,
  resolveThreadTimelineServiceViewMode,
  type ThreadTimelinePageRequest,
  type ThreadTimelineServiceViewMode,
} from "../../src/services/threads/timeline.js";
import { ApiError } from "../../src/errors.js";

const UNPAGINATED_TIMELINE_SEGMENT_LIMIT = Number.MAX_SAFE_INTEGER;

type TimelineTestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;
type TimelineClientTurnRequestTarget =
  StoredThreadEventDataForType<"client/turn/requested">["target"];
type TimelineClientTurnRequestInitiator = NonNullable<
  StoredThreadEventDataForType<"client/turn/requested">["initiator"]
>;

interface TimelineServiceTestOptions {
  includeNestedRows?: boolean;
  isDevelopment: boolean;
  page?: ThreadTimelinePageRequest;
  timelineViewMode?: ThreadTimelineServiceViewMode;
}

interface TimelineTurnSummaryDetailsTestOptions {
  isDevelopment: boolean;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  timelineViewMode?: ThreadTimelineServiceViewMode;
  turnId: string;
}

type TimelineSourceTestRow = Extract<
  TimelineRow,
  { kind: "conversation" | "system" | "work" }
>;

interface SeedTimelineThreadResult {
  environmentId: string;
  thread: Thread;
}

interface SeedTimelineThreadArgs {
  status?: Thread["status"];
  type?: Thread["type"];
}

interface SeedTimelineClientTurnRequestedArgs {
  environmentId: string;
  initiator?: TimelineClientTurnRequestInitiator;
  requestId: string;
  senderThreadId?: string | null;
  sequence: number;
  target: TimelineClientTurnRequestTarget;
  text: string;
  threadId: string;
}

interface ReconstructThreadTimelineByPagesArgs {
  db: DbConnection;
  isDevelopment: boolean;
  segmentLimit: number;
  thread: Thread;
  timelineViewMode?: ThreadTimelineServiceViewMode;
}

function flattenTimelineSourceRows(
  rows: TimelineRow[],
): TimelineSourceTestRow[] {
  const sourceRows: TimelineSourceTestRow[] = [];

  for (const row of rows) {
    switch (row.kind) {
      case "conversation":
      case "system":
        sourceRows.push(row);
        break;
      case "work":
        sourceRows.push(row);
        if (row.workKind === "delegation") {
          sourceRows.push(...flattenTimelineSourceRows(row.childRows));
        }
        break;
      case "turn":
        if (row.children) {
          sourceRows.push(...flattenTimelineSourceRows(row.children));
        }
        break;
    }
  }

  return sourceRows;
}

function buildThreadTimeline(
  db: DbConnection,
  thread: Thread,
  options: TimelineServiceTestOptions,
) {
  return buildThreadTimelineWithResolvedMode(db, thread, {
    ...options,
    page: options.page ?? {
      kind: "latest",
      segmentLimit: UNPAGINATED_TIMELINE_SEGMENT_LIMIT,
    },
    timelineViewMode: options.timelineViewMode ?? "standard",
  });
}

function reconstructThreadTimelineByPages({
  db,
  isDevelopment,
  segmentLimit,
  thread,
  timelineViewMode,
}: ReconstructThreadTimelineByPagesArgs): TimelineRow[] {
  const latestPage = buildThreadTimeline(db, thread, {
    isDevelopment,
    page: {
      kind: "latest",
      segmentLimit,
    },
    timelineViewMode,
  });
  const rows = [...latestPage.rows];
  let olderCursor = latestPage.timelinePage.olderCursor;

  while (olderCursor !== null) {
    const olderPage = buildThreadTimeline(db, thread, {
      isDevelopment,
      page: {
        kind: "older",
        beforeCursor: olderCursor,
        segmentLimit,
      },
      timelineViewMode,
    });
    rows.unshift(...olderPage.rows);
    olderCursor = olderPage.timelinePage.olderCursor;
  }

  return rows;
}

function buildTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: TimelineTurnSummaryDetailsTestOptions,
) {
  return buildTimelineTurnSummaryDetailsWithResolvedMode(db, thread, {
    ...options,
    timelineViewMode: options.timelineViewMode ?? "standard",
  });
}

function seedTimelineThread(
  harness: TimelineTestHarness,
  args: SeedTimelineThreadArgs = {},
): SeedTimelineThreadResult {
  const host = seedHost(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: args.status,
    type: args.type,
  });

  return {
    environmentId: environment.id,
    thread,
  };
}

function seedTimelineClientTurnRequested(
  harness: TimelineTestHarness,
  args: SeedTimelineClientTurnRequestedArgs,
): void {
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: args.sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: args.requestId,
      source: "tell",
      initiator: args.initiator ?? "user",
      senderThreadId:
        args.senderThreadId !== undefined
          ? args.senderThreadId
          : (args.initiator ?? "user") === "agent"
            ? "thr_sender"
            : null,
      request: { method: "turn/start", params: {} },
      input: [{ type: "text", text: args.text }],
      target: args.target,
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    },
  });
}

describe("buildThreadTimeline", () => {
  const harnesses: TimelineTestHarness[] = [];

  afterEach(async () => {
    while (harnesses.length > 0) {
      const harness = harnesses.pop();
      if (!harness) {
        continue;
      }
      await harness.cleanup();
    }
  });

  it("resolves public manager timeline view defaults before timeline projection", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
    });
    const managerThread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      type: "manager",
    });

    expect(
      resolveThreadTimelineServiceViewMode({
        managerTimelineView: undefined,
        thread,
      }),
    ).toBe("standard");
    expect(
      resolveThreadTimelineServiceViewMode({
        managerTimelineView: undefined,
        thread: managerThread,
      }),
    ).toBe("manager-conversation");
    expect(
      resolveThreadTimelineServiceViewMode({
        managerTimelineView: "standard",
        thread: managerThread,
      }),
    ).toBe("standard");
    expect(
      resolveThreadTimelineServiceViewMode({
        managerTimelineView: "conversation",
        thread: managerThread,
      }),
    ).toBe("manager-conversation");
  });

  it("paginates logical segments in server row order", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "standard",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      sequence: 1,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ab",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        input: [{ type: "text", text: "First request" }],
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
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ab",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
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
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 5,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "First answer",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 6,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      scope: threadScope(),
      sequence: 7,
      type: "system/operation",
      data: {
        operation: "ownership_change",
        operationId: "op-1",
        status: "completed",
        message: "Thread operation completed",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      sequence: 8,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_3456789abc",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        input: [{ type: "text", text: "Second request" }],
        target: { kind: "new-turn" },
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
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 9,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 10,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_3456789abc",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 11,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-2",
          text: "Second answer",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 12,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    const fullTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });
    const latestPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: 1,
      },
    });
    const latestOlderCursor = latestPage.timelinePage.olderCursor;
    expect(latestOlderCursor).not.toBeNull();
    if (latestOlderCursor === null) {
      throw new Error("Expected an older cursor for the latest page");
    }

    const olderPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "older",
        beforeCursor: latestOlderCursor,
        segmentLimit: 1,
      },
    });
    const pagedRows = [...olderPage.rows, ...latestPage.rows];

    expect(pagedRows.map((row) => row.id)).toEqual(
      fullTimeline.rows.map((row) => row.id),
    );
    expect(olderPage.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "First request",
    });
    expect(
      olderPage.rows.findIndex(
        (row) => row.kind === "turn" || row.kind === "work",
      ),
    ).toBeGreaterThan(0);
    expect(olderPage.timelinePage).toMatchObject({
      kind: "older",
      segmentLimit: 1,
      returnedSegmentCount: 1,
      hasOlderRows: false,
      olderCursor: null,
    });
  });

  it("backfills the latest backgroundTask state for older pages whose window predates the terminal row", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "standard",
    });
    const workflowItem = (args: {
      id: string;
      description: string;
      taskStatus?: "running" | "completed";
      summary?: string;
    }) => ({
      type: "backgroundTask",
      id: args.id,
      taskType: "local_workflow",
      description: args.description,
      status: args.taskStatus === "completed" ? "completed" : "pending",
      taskStatus: args.taskStatus ?? "running",
      skipTranscript: false,
      workflowName: "fixture-mini",
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
    });

    // Segment 1: the spawning turn containing both workflows' item/started.
    seedTimelineClientTurnRequested(harness, {
      environmentId,
      requestId: "creq_23456789ab",
      sequence: 1,
      target: { kind: "thread-start" },
      text: "Workflow request",
      threadId: thread.id,
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/input/accepted",
      data: { clientRequestId: "creq_23456789ab" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/started",
      data: {
        providerThreadId: "provider-thread-1",
        item: workflowItem({
          id: "task:wf-done",
          description: "done workflow",
        }),
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 5,
      type: "item/started",
      data: {
        providerThreadId: "provider-thread-1",
        item: workflowItem({
          id: "task:wf-live",
          description: "stale snapshot",
        }),
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 6,
      type: "turn/completed",
      data: { status: "completed" },
    });

    // Segment 2: a later turn pushing the workflows' thread-scoped state rows
    // past the older page's window.
    seedTimelineClientTurnRequested(harness, {
      environmentId,
      requestId: "creq_3456789abc",
      sequence: 10,
      target: { kind: "new-turn" },
      text: "Second request",
      threadId: thread.id,
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 11,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 12,
      type: "turn/input/accepted",
      data: { clientRequestId: "creq_3456789abc" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 13,
      type: "turn/completed",
      data: { status: "completed" },
    });

    // Segment 3: a third turn so the workflows' page is a bounded middle
    // window (the window before the newest anchor has no upper bound).
    seedTimelineClientTurnRequested(harness, {
      environmentId,
      requestId: "creq_456789abcd",
      sequence: 30,
      target: { kind: "new-turn" },
      text: "Third request",
      threadId: thread.id,
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-3"),
      sequence: 31,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-3"),
      sequence: 32,
      type: "turn/input/accepted",
      data: { clientRequestId: "creq_456789abcd" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-3"),
      sequence: 33,
      type: "turn/completed",
      data: { status: "completed" },
    });

    // Both workflows keep streaming after their spawning turn. The live one's
    // latest snapshot updates its description; the done one ends with a
    // terminal completed row that supersedes an older running snapshot.
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: threadScope(),
      sequence: 40,
      type: "item/backgroundTask/progress",
      data: {
        providerThreadId: "provider-thread-1",
        item: workflowItem({
          id: "task:wf-live",
          description: "live workflow snapshot",
        }),
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: threadScope(),
      sequence: 41,
      type: "item/backgroundTask/progress",
      data: {
        providerThreadId: "provider-thread-1",
        item: workflowItem({
          id: "task:wf-done",
          description: "done workflow",
        }),
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: threadScope(),
      sequence: 42,
      type: "item/backgroundTask/completed",
      data: {
        providerThreadId: "provider-thread-1",
        item: workflowItem({
          id: "task:wf-done",
          description: "done workflow",
          taskStatus: "completed",
          summary: "done workflow completed",
        }),
      },
    });

    const latestPage = buildThreadTimeline(harness.db, thread, {
      includeNestedRows: true,
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: 1,
      },
    });
    const latestOlderCursor = latestPage.timelinePage.olderCursor;
    if (latestOlderCursor === null) {
      throw new Error("Expected an older cursor for the latest page");
    }
    const middlePage = buildThreadTimeline(harness.db, thread, {
      includeNestedRows: true,
      isDevelopment: true,
      page: {
        kind: "older",
        beforeCursor: latestOlderCursor,
        segmentLimit: 1,
      },
    });
    const middleOlderCursor = middlePage.timelinePage.olderCursor;
    if (middleOlderCursor === null) {
      throw new Error("Expected an older cursor for the middle page");
    }

    // The oldest page's window ends at the next anchor — far before the
    // thread-scoped state rows: only the backfill can deliver each workflow's
    // current state.
    const olderPage = buildThreadTimeline(harness.db, thread, {
      includeNestedRows: true,
      isDevelopment: true,
      page: {
        kind: "older",
        beforeCursor: middleOlderCursor,
        segmentLimit: 1,
      },
    });

    const workflowRows = flattenTimelineSourceRows(olderPage.rows)
      .filter((row) => row.kind === "work" && row.workKind === "workflow")
      .sort((left, right) => left.sourceSeqStart - right.sourceSeqStart);
    expect(workflowRows).toHaveLength(2);
    // The settled workflow shows its terminal state instead of pinning
    // "running" forever.
    expect(workflowRows[0]).toMatchObject({
      workKind: "workflow",
      itemId: "task:wf-done",
      taskStatus: "completed",
      summary: "done workflow completed",
    });
    // The live workflow renders its LATEST backfilled snapshot (seq 20), not
    // the stale in-window item/started payload.
    expect(workflowRows[1]).toMatchObject({
      workKind: "workflow",
      itemId: "task:wf-live",
      taskStatus: "running",
      description: "live workflow snapshot",
    });
  });

  it("keeps standard timeline rows that cross the older-page cursor anchor", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);
    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "standard",
    });
    const crossingAssistantText = "Crossing response from turn 2";

    for (let index = 0; index < 4; index += 1) {
      const turnNumber = index + 1;
      const sequenceBase = turnNumber * 10;
      const requestId = `creq_23456789a${["b", "c", "d", "e"][index]}`;
      seedTimelineClientTurnRequested(harness, {
        environmentId,
        requestId,
        sequence: sequenceBase + 1,
        target: { kind: "new-turn" },
        text: `Standard request ${turnNumber}`,
        threadId: thread.id,
      });

      const crossesCursorAnchor = turnNumber === 2;
      const lifecycleSequenceBase =
        turnNumber === 3 ? sequenceBase + 3 : sequenceBase + 1;
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope(`turn-${turnNumber}`),
        sequence: lifecycleSequenceBase + 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope(`turn-${turnNumber}`),
        sequence: lifecycleSequenceBase + 2,
        type: "turn/input/accepted",
        data: {
          clientRequestId: requestId,
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope(`turn-${turnNumber}`),
        sequence: crossesCursorAnchor ? 32 : lifecycleSequenceBase + 3,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: `assistant-${turnNumber}`,
            text: crossesCursorAnchor
              ? crossingAssistantText
              : `Standard response ${turnNumber}`,
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope(`turn-${turnNumber}`),
        sequence: crossesCursorAnchor ? 33 : lifecycleSequenceBase + 4,
        type: "turn/completed",
        data: {
          status: "completed",
        },
      });
    }

    const fullTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });
    const olderPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "older",
        beforeCursor: {
          anchorSeq: 31,
          anchorId: `${thread.id}:user-seed:31`,
        },
        segmentLimit: 1,
      },
    });
    const reconstructedRows = reconstructThreadTimelineByPages({
      db: harness.db,
      isDevelopment: true,
      segmentLimit: 1,
      thread,
    });

    expect(olderPage.rows).toContainEqual(
      expect.objectContaining({
        kind: "conversation",
        role: "assistant",
        text: crossingAssistantText,
      }),
    );
    expect(reconstructedRows.map((row) => row.id)).toEqual(
      fullTimeline.rows.map((row) => row.id),
    );
  });

  it("paginates manager conversation timeline rows from an event window", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);
    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "manager",
    });

    for (let index = 0; index < 5; index += 1) {
      const turnNumber = index + 1;
      const sequenceBase = turnNumber * 10;
      const includesPostAnchorOperation = turnNumber === 3;
      const lifecycleSequenceOffset = includesPostAnchorOperation ? 1 : 0;
      seedTimelineClientTurnRequested(harness, {
        environmentId,
        requestId: `creq_23456789a${["b", "c", "d", "e", "f"][index]}`,
        sequence: sequenceBase + 1,
        target: { kind: "new-turn" },
        text: `Manager request ${turnNumber}`,
        threadId: thread.id,
      });
      if (includesPostAnchorOperation) {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId,
          providerThreadId: "provider-thread-1",
          scope: threadScope(),
          sequence: sequenceBase + 2,
          type: "provider/unhandled",
          data: {
            providerId: "codex",
            rawType: "remoteControl/status/changed",
            rawEvent: {
              jsonrpc: "2.0",
              method: "remoteControl/status/changed",
              params: {
                threadId: thread.id,
              },
            },
          },
        });
      }
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope(`turn-${turnNumber}`),
        sequence: sequenceBase + 2 + lifecycleSequenceOffset,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope(`turn-${turnNumber}`),
        sequence: sequenceBase + 3 + lifecycleSequenceOffset,
        type: "turn/input/accepted",
        data: {
          clientRequestId: `creq_23456789a${["b", "c", "d", "e", "f"][index]}`,
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        sequence: sequenceBase + 4 + lifecycleSequenceOffset,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: {
          text: `Manager response ${turnNumber}`,
          toolCallId: `tool-${turnNumber}`,
          turnId: `turn-${turnNumber}`,
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope(`turn-${turnNumber}`),
        sequence: sequenceBase + 5 + lifecycleSequenceOffset,
        type: "turn/completed",
        data: {
          status: "completed",
        },
      });
    }

    const fullTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      timelineViewMode: "manager-conversation",
    });
    const crossingOperationRowId = `${thread.id}:op:provider-unhandled:32`;
    const directOlderPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "older",
        beforeCursor: {
          anchorSeq: 31,
          anchorId: `${thread.id}:user-seed:31`,
        },
        segmentLimit: 1,
      },
      timelineViewMode: "manager-conversation",
    });
    const reconstructedRows = reconstructThreadTimelineByPages({
      db: harness.db,
      isDevelopment: true,
      segmentLimit: 1,
      thread,
      timelineViewMode: "manager-conversation",
    });
    const latestPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: 2,
      },
      timelineViewMode: "manager-conversation",
    });
    const latestOlderCursor = latestPage.timelinePage.olderCursor;
    expect(latestOlderCursor).not.toBeNull();
    if (latestOlderCursor === null) {
      throw new Error("Expected an older cursor for the latest page");
    }
    const olderPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "older",
        beforeCursor: latestOlderCursor,
        segmentLimit: 3,
      },
      timelineViewMode: "manager-conversation",
    });
    const pagedRows = [...olderPage.rows, ...latestPage.rows];

    expect(directOlderPage.rows.map((row) => row.id)).toContain(
      crossingOperationRowId,
    );
    expect(reconstructedRows.map((row) => row.id)).toEqual(
      fullTimeline.rows.map((row) => row.id),
    );
    expect(pagedRows.map((row) => row.id)).toEqual(
      fullTimeline.rows.map((row) => row.id),
    );
  });

  it("uses the same manager conversation range selector without anchors", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);
    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "manager",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      sequence: 1,
      type: "system/thread-provisioning",
      scope: threadScope(),
      data: {
        provisioningId: "tpv-1",
        status: "completed",
        environmentId,
        entries: [
          {
            type: "step",
            key: "workspace-path",
            text: "Using workspace: /tmp/test",
            status: "completed",
          },
        ],
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: 20,
      },
      timelineViewMode: "manager-conversation",
    });

    expect(timeline.rows.length).toBeGreaterThan(0);
    expect(timeline.timelinePage.kind).toBe("latest");
  });

  it("keeps accepted in-turn steers inside the primary message segment", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "standard",
    });

    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 1,
      requestId: "creq_23456789ab",
      text: "Initial request",
      target: { kind: "thread-start" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ab",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/completed",
      data: {
        item: {
          type: "toolCall",
          id: "tool-before-steer",
          tool: "exec_command",
          arguments: { cmd: "pnpm test" },
          status: "completed",
        },
      },
    });
    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 5,
      requestId: "creq_3456789abc",
      text: "Accepted steer",
      target: { kind: "auto", expectedTurnId: "turn-1" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 6,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_3456789abc",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 7,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 8,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    const latestPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: 1,
      },
    });
    const userRows = latestPage.rows.filter(
      (row) => row.kind === "conversation" && row.role === "user",
    );

    expect(latestPage.timelinePage).toMatchObject({
      kind: "latest",
      returnedSegmentCount: 1,
      hasOlderRows: false,
      olderCursor: null,
    });
    expect(latestPage.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "Initial request",
      turnRequest: {
        kind: "message",
        status: "accepted",
      },
    });
    expect(userRows.map((row) => row.text)).toEqual([
      "Initial request",
      "Accepted steer",
    ]);
    expect(userRows.map((row) => row.turnRequest)).toEqual([
      { kind: "message", status: "accepted" },
      { kind: "steer", status: "accepted" },
    ]);
  });

  it("uses later accepted rows as context for older-page pending steer projection", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
      type: "standard",
    });

    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 1,
      requestId: "creq_23456789ab",
      text: "Initial request",
      target: { kind: "thread-start" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ab",
      },
    });
    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 4,
      requestId: "creq_3456789abc",
      text: "Context-only steer",
      target: { kind: "auto", expectedTurnId: "turn-1" },
    });
    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 5,
      requestId: "creq_456789abcd",
      text: "Later request",
      target: { kind: "new-turn" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 6,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_3456789abc",
      },
    });

    const olderPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "older",
        beforeCursor: {
          anchorId: `${thread.id}:user-seed:5`,
          anchorSeq: 5,
        },
        segmentLimit: 1,
      },
    });
    const userRows = flattenTimelineSourceRows(olderPage.rows).filter(
      (row) => row.kind === "conversation" && row.role === "user",
    );

    expect(userRows.map((row) => row.text)).toEqual(["Initial request"]);
    expect(userRows.map((row) => row.turnRequest)).toEqual([
      { kind: "message", status: "accepted" },
    ]);
  });

  it("builds a paged timeline when the selected window needs an earlier turn start", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "idle",
      type: "standard",
    });

    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 1,
      requestId: "creq_23456789ab",
      text: "Initial request",
      target: { kind: "thread-start" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ab",
      },
    });
    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 4,
      requestId: "creq_3456789abc",
      text: "Boundary request",
      target: { kind: "new-turn" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      sequence: 5,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_3456789abc",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 6,
      type: "turn/started",
      data: {},
    });
    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 7,
      requestId: "creq_456789abcd",
      text: "Latest request",
      target: { kind: "new-turn" },
    });

    const latestPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: 1,
      },
    });
    const userRows = latestPage.rows.filter(
      (row) => row.kind === "conversation" && row.role === "user",
    );

    expect(latestPage.timelinePage).toMatchObject({
      kind: "latest",
      returnedSegmentCount: 1,
      hasOlderRows: true,
    });
    expect(userRows.map((row) => row.text)).toEqual(["Latest request"]);
  });

  it("keeps pending steers inside the active primary message segment", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
      type: "standard",
    });

    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 1,
      requestId: "creq_456789abcd",
      text: "Initial request",
      target: { kind: "thread-start" },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_456789abcd",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/completed",
      data: {
        item: {
          type: "toolCall",
          id: "tool-before-pending-steer",
          tool: "exec_command",
          arguments: { cmd: "pnpm test" },
          status: "completed",
        },
      },
    });
    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 5,
      requestId: "creq_56789abcde",
      text: "Pending steer",
      target: { kind: "auto", expectedTurnId: "turn-1" },
    });

    const latestPage = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: 1,
      },
    });
    const userRows = latestPage.rows.filter(
      (row) => row.kind === "conversation" && row.role === "user",
    );

    expect(latestPage.timelinePage).toMatchObject({
      kind: "latest",
      returnedSegmentCount: 1,
      hasOlderRows: false,
      olderCursor: null,
    });
    expect(latestPage.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "Initial request",
      turnRequest: {
        kind: "message",
        status: "accepted",
      },
    });
    expect(userRows.map((row) => row.text)).toEqual([
      "Initial request",
      "Pending steer",
    ]);
    expect(userRows.map((row) => row.turnRequest)).toEqual([
      { kind: "message", status: "accepted" },
      { kind: "steer", status: "pending" },
    ]);
  });

  it("returns a 400 invalid_request for stale timeline pagination cursors", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "standard",
    });

    seedTimelineClientTurnRequested(harness, {
      threadId: thread.id,
      environmentId,
      sequence: 1,
      requestId: "creq_6789abcdef",
      text: "Initial request",
      target: { kind: "thread-start" },
    });

    let thrownError: ApiError | null = null;
    try {
      buildThreadTimeline(harness.db, thread, {
        isDevelopment: true,
        page: {
          kind: "older",
          beforeCursor: {
            anchorSeq: 999,
            anchorId: "missing-anchor",
          },
          segmentLimit: 1,
        },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        thrownError = error;
      } else {
        throw error;
      }
    }

    expect(thrownError).toMatchObject({
      status: 400,
      body: {
        code: "invalid_request",
        message: "Timeline pagination cursor is no longer available",
      },
    });
  });

  it("paginates standard timeline anchors with server visibility rules", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const standardThread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      type: "standard",
    });
    const managerThread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      type: "manager",
    });

    for (const thread of [standardThread, managerThread]) {
      seedTimelineClientTurnRequested(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        requestId: "creq_23456789ab",
        text: "User message",
        target: { kind: "new-turn" },
      });
      seedTimelineClientTurnRequested(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        initiator: "system",
        sequence: 2,
        requestId: "creq_3456789abc",
        text: "System message",
        target: { kind: "new-turn" },
      });
      seedTimelineClientTurnRequested(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 3,
        requestId: "creq_456789abcd",
        text: "Auto new turn",
        target: { kind: "auto", expectedTurnId: null },
      });
      seedTimelineClientTurnRequested(harness, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 4,
        requestId: "creq_56789abcde",
        text: "Pending steer",
        target: { kind: "auto", expectedTurnId: "turn-1" },
      });
    }

    const standardLatestPage = buildThreadTimeline(harness.db, standardThread, {
      isDevelopment: false,
      page: {
        kind: "latest",
        segmentLimit: 2,
      },
    });
    const standardUserTexts = flattenTimelineSourceRows(
      standardLatestPage.rows,
    ).flatMap((row) =>
      row.kind === "conversation" && row.role === "user" ? [row.text] : [],
    );

    expect(standardLatestPage.timelinePage).toMatchObject({
      kind: "latest",
      segmentLimit: 2,
      returnedSegmentCount: 2,
      hasOlderRows: false,
      olderCursor: null,
    });
    expect(standardUserTexts).toContain("User message");
    expect(standardUserTexts).toContain("Auto new turn");
    expect(standardUserTexts).not.toContain("System message");

    const managerStandardLatestPage = buildThreadTimeline(
      harness.db,
      managerThread,
      {
        isDevelopment: false,
        page: {
          kind: "latest",
          segmentLimit: 2,
        },
      },
    );
    const managerStandardUserTexts = flattenTimelineSourceRows(
      managerStandardLatestPage.rows,
    ).flatMap((row) =>
      row.kind === "conversation" && row.role === "user" ? [row.text] : [],
    );

    expect(managerStandardLatestPage.timelinePage).toMatchObject({
      kind: "latest",
      segmentLimit: 2,
      returnedSegmentCount: 2,
      hasOlderRows: true,
      olderCursor: {
        anchorId: `${managerThread.id}:user-seed:2`,
        anchorSeq: 2,
      },
    });
    expect(managerStandardUserTexts).not.toContain("User message");
    expect(managerStandardUserTexts).toContain("System message");
    expect(managerStandardUserTexts).toContain("Auto new turn");
  });

  it("preserves completed assistant content and excludes summary-noise rows after compaction", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 1,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      type: "turn/started",
      data: {},
    });

    for (let index = 0; index < 1000; index += 1) {
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environmentId,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: index + 2,
        type: "item/agentMessage/delta",
        data: {
          itemId: "msg-1",
          delta: index === 0 ? "Final" : " chunk",
        },
      });
    }

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1002,
      type: "item/completed",
      data: {
        item: {
          id: "msg-1",
          type: "agentMessage",
          text: "Final answer",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1003,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1004,
      type: "thread/contextWindowUsage/updated",
      data: {
        contextWindowUsage: {
          usedTokens: 42,
          modelContextWindow: 200_000,
          estimated: false,
        },
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.rows).toHaveLength(1);
    expect(timeline.rows[0]).toMatchObject({
      kind: "conversation",
      role: "assistant",
      text: "Final answer",
      sourceSeqStart: 2,
      sourceSeqEnd: 1002,
    });
    expect(timeline.contextWindowUsage).toEqual({
      usedTokens: 42,
      modelContextWindow: 200_000,
      estimated: false,
    });
  });

  it("shows provider unhandled rows in development only", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: threadScope(),
      sequence: 1,
      type: "provider/unhandled",
      data: {
        providerId: "codex",
        rawType: "item/tool/requestUserInput",
        rawEvent: {
          jsonrpc: "2.0",
          method: "item/tool/requestUserInput",
          params: {
            threadId: thread.id,
          },
        },
      },
    });

    expect(
      buildThreadTimeline(harness.db, thread, { isDevelopment: false }).rows,
    ).toEqual([]);

    const developmentTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });
    const developmentRows = developmentTimeline.rows.filter(
      (row): row is Extract<TimelineRow, { kind: "system" }> =>
        row.kind === "system",
    );

    expect(developmentRows).toHaveLength(1);
    expect(developmentRows[0]).toMatchObject({
      systemKind: "operation",
      title: "Unhandled Codex event",
    });
  });

  it("reports active thinking even when a reasoning block has no visible text yet", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      createdAt: 100,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      createdAt: 200,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [],
          content: [],
        },
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toMatchObject({
      id: "reasoning-1",
      text: "",
      startedAt: 200,
      updatedAt: 200,
    });
    expect(timeline.rows).toEqual([]);
  });

  it("keeps partial streaming thinking details hidden until a newline boundary", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      createdAt: 100,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      createdAt: 250,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: "Looking through the workspace.",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toMatchObject({
      id: "reasoning-1",
      text: "",
      startedAt: 250,
      updatedAt: 250,
    });
    expect(timeline.rows).toEqual([]);
  });

  it("returns newline-complete streaming thinking separately without rendering a timeline reasoning row", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      createdAt: 100,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      createdAt: 300,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: "Looking through the workspace.\nTrailing partial",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toMatchObject({
      id: "reasoning-1",
      text: "Looking through the workspace.\n",
      startedAt: 300,
      updatedAt: 300,
    });
    expect(timeline.rows).toEqual([]);
  });

  it("advances active thinking updatedAt when later reasoning deltas arrive", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      createdAt: 100,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      createdAt: 150,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [],
          content: [],
        },
      },
    });
    seedEvent(harness.deps, {
      createdAt: 250,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: "Looking through the workspace.",
      },
    });
    seedEvent(harness.deps, {
      createdAt: 400,
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: "\nNext step",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toMatchObject({
      id: "reasoning-1",
      text: "Looking through the workspace.\n",
      startedAt: 150,
      updatedAt: 400,
    });
    expect(timeline.activeThinking?.updatedAt).toBeGreaterThan(
      timeline.activeThinking?.startedAt ?? 0,
    );
  });

  it("removes completed thinking from summary rows", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: "Thinking through the answer.",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [],
          content: ["Thinking through the answer."],
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 5,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toBeNull();
    expect(timeline.rows).toHaveLength(1);
    expect(timeline.rows[0]).toMatchObject({
      kind: "conversation",
      role: "assistant",
      text: "Done.",
    });
  });

  it("clears active thinking when the thread is interrupted before reasoning completes", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [],
          content: [],
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: "Partial reasoning",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      scope: threadScope(),
      sequence: 4,
      type: "system/thread/interrupted",
      data: {
        turnId: "turn-1",
        reason: "manual-stop",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toBeNull();
  });

  it("surfaces active thinking only for active threads", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [],
          content: [],
        },
      },
    });

    const activeTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });
    const provisioningTimeline = buildThreadTimeline(
      harness.db,
      {
        ...thread,
        status: "provisioning",
      },
      { isDevelopment: true },
    );
    const idleTimeline = buildThreadTimeline(
      harness.db,
      {
        ...thread,
        status: "idle",
      },
      { isDevelopment: true },
    );

    expect(activeTimeline.activeThinking).toMatchObject({
      id: "reasoning-1",
      text: "",
    });
    expect(provisioningTimeline.activeThinking).toBeNull();
    expect(idleTimeline.activeThinking).toBeNull();
  });

  it("does not reopen active thinking on active threads after a reasoning item completes", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [],
          content: [],
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: ["Final reasoning"],
          content: [],
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: " late",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toBeNull();
  });

  it("does not surface active thinking after an interrupted turn receives a fresh late reasoning item", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      scope: threadScope(),
      sequence: 2,
      type: "system/thread/interrupted",
      data: {
        reason: "manual-stop",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-99",
        delta: " late",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toBeNull();
  });

  it("forwards pendingTodos from latest TodoWrite for active threads, hides on manager-conversation view", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/completed",
      data: {
        item: {
          type: "toolCall",
          id: "todo-call-1",
          tool: "TodoWrite",
          arguments: {
            todos: [
              { content: "Investigate bug", status: "in_progress" },
              { content: "Write fix", status: "pending" },
            ],
          },
          status: "completed",
        },
      },
    });

    const latestTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });
    expect(latestTimeline.pendingTodos).toMatchObject({
      sourceSeq: 2,
      items: [
        { text: "Investigate bug", status: "in_progress" },
        { text: "Write fix", status: "pending" },
      ],
    });

    const managerConversationTimeline = buildThreadTimeline(
      harness.db,
      thread,
      {
        isDevelopment: true,
        timelineViewMode: "manager-conversation",
      },
    );
    expect(managerConversationTimeline.pendingTodos).toBeNull();
  });

  // older-page nulling of `pendingTodos` is a single ternary in timeline.ts
  // and the equivalent activeThinking branch is already covered indirectly by
  // the existing pagination tests. The projection-level "active turn only"
  // gate is unit-tested in @bb/thread-view's todo-snapshot-extraction.test.ts.

  it("hides pendingTodos when the thread is not active", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "item/completed",
      data: {
        item: {
          type: "toolCall",
          id: "todo-call-1",
          tool: "TodoWrite",
          arguments: {
            todos: [{ content: "stale", status: "in_progress" }],
          },
          status: "completed",
        },
      },
    });

    const idleTimeline = buildThreadTimeline(
      harness.db,
      { ...thread, status: "idle" },
      { isDevelopment: true },
    );
    expect(idleTimeline.pendingTodos).toBeNull();

    const errorTimeline = buildThreadTimeline(
      harness.db,
      { ...thread, status: "error" },
      { isDevelopment: true },
    );
    expect(errorTimeline.pendingTodos).toBeNull();
  });

  it("does not attach visible reasoning details from a different open reasoning item", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      status: "active",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [],
          content: [],
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/reasoning/textDelta",
      data: {
        itemId: "reasoning-1",
        delta: "Visible reasoning.\nTrailing partial",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/started",
      data: {
        item: {
          type: "reasoning",
          id: "reasoning-2",
          summary: [],
          content: [],
        },
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.activeThinking).toMatchObject({
      id: "reasoning-2",
      text: "",
    });
  });

  it("keeps the last non-null modelContextWindow when the newest context-usage row omits it", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "thread/contextWindowUsage/updated",
      data: {
        contextWindowUsage: {
          usedTokens: 120,
          modelContextWindow: 200_000,
          estimated: false,
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 2,
      type: "thread/contextWindowUsage/updated",
      data: {
        contextWindowUsage: {
          usedTokens: 60,
          modelContextWindow: null,
          estimated: true,
        },
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.contextWindowUsage).toEqual({
      usedTokens: 60,
      modelContextWindow: 200_000,
      estimated: true,
    });
  });

  it("does not reuse older used-token values when the newest context usage is explicitly unknown", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "thread/contextWindowUsage/updated",
      data: {
        contextWindowUsage: {
          usedTokens: 120_000,
          modelContextWindow: 200_000,
          estimated: false,
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 2,
      type: "thread/contextWindowUsage/updated",
      data: {
        contextWindowUsage: {
          usedTokens: null,
          modelContextWindow: 200_000,
          estimated: true,
        },
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });

    expect(timeline.contextWindowUsage).toBeUndefined();
  });

  it("fails loudly when turn summary details cannot match a projected turn-summary range", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
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
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    expect(() =>
      buildTimelineTurnSummaryDetails(harness.db, thread, {
        isDevelopment: true,
        turnId: "turn-1",
        sourceSeqStart: 1,
        sourceSeqEnd: 5,
      }),
    ).toThrow(/Timeline turn summary details could not match range 1-5/);
  });

  it("matches tool detail ranges whose end depends on the following input-accepted event", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
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
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 5,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ab",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        input: [{ type: "text", text: "Follow-up" }],
        target: { kind: "new-turn" },
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
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 8,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ab",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });
    const turnSummary = timeline.rows.find((row) => row.kind === "turn");

    expect(turnSummary).toMatchObject({
      sourceSeqStart: 1,
      sourceSeqEnd: 5,
    });

    const details = buildTimelineTurnSummaryDetails(harness.db, thread, {
      isDevelopment: true,
      turnId: "turn-1",
      sourceSeqStart: 1,
      sourceSeqEnd: 5,
    });
    const detailRows = flattenTimelineSourceRows(details.rows);
    const toolRows = detailRows.filter(
      (row): row is Extract<TimelineRow, { kind: "work"; workKind: "tool" }> =>
        row.kind === "work" && row.workKind === "tool",
    );

    expect(toolRows).toHaveLength(1);
    expect(toolRows[0]).toMatchObject({
      kind: "work",
      workKind: "tool",
      sourceSeqStart: 2,
      sourceSeqEnd: 2,
    });
  });

  it("loads details for stale turn-summary ranges whose queued message is accepted by the next turn", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "standard",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
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
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      sequence: 5,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ad",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        input: [{ type: "text", text: "Queued follow-up" }],
        target: { kind: "new-turn" },
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
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 6,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 7,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ad",
      },
    });

    const details = buildTimelineTurnSummaryDetails(harness.db, thread, {
      isDevelopment: true,
      turnId: "turn-1",
      sourceSeqStart: 1,
      sourceSeqEnd: 5,
    });
    const detailRows = flattenTimelineSourceRows(details.rows);
    expect(
      detailRows.map(({ sourceSeqEnd, sourceSeqStart }) => ({
        sourceSeqEnd,
        sourceSeqStart,
      })),
    ).toEqual([{ sourceSeqEnd: 2, sourceSeqStart: 2 }]);
    expect(
      detailRows.some(
        (row) => row.sourceSeqStart <= 5 && row.sourceSeqEnd >= 5,
      ),
    ).toBe(false);
    expect(
      detailRows.some(
        (row) => row.kind === "conversation" && row.text === "Queued follow-up",
      ),
    ).toBe(false);
    const toolRows = detailRows.filter(
      (row): row is Extract<TimelineRow, { kind: "work"; workKind: "tool" }> =>
        row.kind === "work" && row.workKind === "tool",
    );

    expect(toolRows).toEqual([
      expect.objectContaining({
        kind: "work",
        workKind: "tool",
        sourceSeqStart: 2,
        sourceSeqEnd: 2,
      }),
    ]);
  });

  it("keeps requested-turn accepted queued messages while filtering queued messages accepted by later turns", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "standard",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
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
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      sequence: 5,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ae",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        input: [{ type: "text", text: "Requested-turn follow-up" }],
        target: { kind: "new-turn" },
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
      threadId: thread.id,
      environmentId,
      sequence: 6,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789af",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        input: [{ type: "text", text: "Later-turn follow-up" }],
        target: { kind: "new-turn" },
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
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 7,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ae",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 8,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-2"),
      sequence: 9,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789af",
      },
    });

    const details = buildTimelineTurnSummaryDetails(harness.db, thread, {
      isDevelopment: true,
      turnId: "turn-1",
      sourceSeqStart: 1,
      sourceSeqEnd: 6,
    });
    const detailRows = flattenTimelineSourceRows(details.rows);

    expect(detailRows).toEqual([
      expect.objectContaining({
        kind: "work",
        workKind: "tool",
        sourceSeqStart: 2,
        sourceSeqEnd: 2,
      }),
    ]);
    expect(
      detailRows.map(({ sourceSeqEnd, sourceSeqStart }) => ({
        sourceSeqEnd,
        sourceSeqStart,
      })),
    ).toEqual([{ sourceSeqEnd: 2, sourceSeqStart: 2 }]);
    expect(
      detailRows.some(
        (row) => row.sourceSeqStart <= 6 && row.sourceSeqEnd >= 6,
      ),
    ).toBe(false);
    expect(
      detailRows.some(
        (row) =>
          row.kind === "conversation" && row.text === "Later-turn follow-up",
      ),
    ).toBe(false);
  });

  it("finds matching input-accepted events without a widening lookahead cap", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
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
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 5,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ac",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        input: [{ type: "text", text: "Follow-up" }],
        target: { kind: "new-turn" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      },
    });

    for (let sequence = 6; sequence < 136; sequence += 1) {
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environmentId,
        sequence,
        type: "system/thread-provisioning",
        scope: threadScope(),
        data: {
          provisioningId: `tpv-${sequence}`,
          status: "completed",
          environmentId: environmentId,
          entries: [],
        },
      });
    }

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 136,
      type: "turn/input/accepted",
      data: {
        clientRequestId: "creq_23456789ac",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
    });
    const turnSummary = timeline.rows.find((row) => row.kind === "turn");

    expect(turnSummary).toMatchObject({
      sourceSeqStart: 1,
      sourceSeqEnd: 5,
    });

    const details = buildTimelineTurnSummaryDetails(harness.db, thread, {
      isDevelopment: true,
      turnId: "turn-1",
      sourceSeqStart: 1,
      sourceSeqEnd: 5,
    });

    const detailRows = flattenTimelineSourceRows(details.rows);
    const toolRows = detailRows.filter(
      (row): row is Extract<TimelineRow, { kind: "work"; workKind: "tool" }> =>
        row.kind === "work" && row.workKind === "tool",
    );

    expect(toolRows).toEqual([
      expect.objectContaining({
        kind: "work",
        workKind: "tool",
        sourceSeqStart: 2,
        sourceSeqEnd: 2,
      }),
    ]);
  });

  it("returns flattened turn-summary details rows when the selected range has no turn summaries", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Nothing to expand.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    const details = buildTimelineTurnSummaryDetails(harness.db, thread, {
      isDevelopment: true,
      turnId: "turn-1",
      sourceSeqStart: 1,
      sourceSeqEnd: 3,
    });
    const detailRows = flattenTimelineSourceRows(details.rows);

    expect(detailRows).toHaveLength(1);
    expect(detailRows[0]?.kind).toBe("conversation");
    if (detailRows[0]?.kind === "conversation") {
      expect(detailRows[0].text).toBe("Nothing to expand.");
    }
  });

  it("returns details for turn-scoped ranges that start after turn/started", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pnpm test",
          cwd: "/repo",
          status: "pending",
          approvalStatus: null,
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/commandExecution/outputDelta",
      data: {
        itemId: "command-1",
        delta: "pass\n",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/completed",
      data: {
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pnpm test",
          cwd: "/repo",
          status: "completed",
          approvalStatus: null,
          aggregatedOutput: "pass\n",
          exitCode: 0,
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 5,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    const details = buildTimelineTurnSummaryDetails(harness.db, thread, {
      isDevelopment: true,
      turnId: "turn-1",
      sourceSeqStart: 2,
      sourceSeqEnd: 4,
    });
    const detailRows = flattenTimelineSourceRows(details.rows);

    expect(detailRows).toEqual([
      expect.objectContaining({
        kind: "work",
        workKind: "command",
        sourceSeqStart: 2,
        sourceSeqEnd: 4,
        command: "pnpm test",
      }),
    ]);
  });

  it("rejects turn-summary detail ranges that do not match the requested turn", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Done.",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    expect(() =>
      buildTimelineTurnSummaryDetails(harness.db, thread, {
        isDevelopment: true,
        turnId: "turn-2",
        sourceSeqStart: 1,
        sourceSeqEnd: 3,
      }),
    ).toThrow(/includes turn turn-1 instead of turn-2/);
  });

  it("applies provider unhandled gating to turn-summary details", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness);

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "provider/unhandled",
      data: {
        providerId: "codex",
        rawType: "item/tool/requestUserInput",
        rawEvent: {
          jsonrpc: "2.0",
          method: "item/tool/requestUserInput",
          params: {
            threadId: thread.id,
            turnId: "turn-1",
          },
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    expect(
      buildTimelineTurnSummaryDetails(harness.db, thread, {
        isDevelopment: false,
        turnId: "turn-1",
        sourceSeqStart: 1,
        sourceSeqEnd: 3,
      }).rows,
    ).toEqual([]);

    const developmentDetails = buildTimelineTurnSummaryDetails(
      harness.db,
      thread,
      {
        isDevelopment: true,
        turnId: "turn-1",
        sourceSeqStart: 1,
        sourceSeqEnd: 3,
      },
    );
    const standardManagerDetails = buildTimelineTurnSummaryDetails(
      harness.db,
      thread,
      {
        isDevelopment: false,
        turnId: "turn-1",
        sourceSeqStart: 1,
        sourceSeqEnd: 3,
      },
    );
    const developmentRows = flattenTimelineSourceRows(developmentDetails.rows);
    const standardManagerRows = flattenTimelineSourceRows(
      standardManagerDetails.rows,
    );

    expect(developmentRows).toHaveLength(1);
    expect(developmentRows[0]).toMatchObject({
      kind: "system",
      systemKind: "operation",
      title: "Unhandled Codex event",
    });
    expect(standardManagerRows).toEqual([]);
  });

  it("filters manager thread timeline to user messages, message_user output, and operations", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "manager",
    });

    // System-initiated welcome message (hidden by default manager conversation view)
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 1,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ab",
        source: "spawn",
        initiator: "system",
        senderThreadId: null,
        input: [{ type: "text", text: "[bb system]\n\nWelcome!" }],
        target: { kind: "thread-start" },
        request: { method: "thread/start", params: {} },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      },
    });

    // Provisioning operation (should be visible)
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 2,
      type: "system/thread-provisioning",
      scope: threadScope(),
      data: {
        provisioningId: "tpv-1",
        status: "completed",
        environmentId: environmentId,
        entries: [
          {
            type: "step",
            key: "workspace-path",
            text: "Using workspace: /tmp/test",
            status: "completed",
          },
        ],
      },
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "turn/started",
      data: {},
    });

    // Internal assistant text (should be hidden)
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 4,
      type: "item/completed",
      data: {
        item: {
          id: "msg-1",
          type: "agentMessage",
          text: "internal reasoning",
        },
      },
    });

    // Buffered internal assistant delta (should be hidden in the default view)
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 5,
      type: "item/agentMessage/delta",
      data: {
        itemId: "msg-buffered",
        delta: "buffered manager delta",
      },
    });

    // Internal tool call (should be hidden)
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 6,
      type: "item/completed",
      data: {
        item: {
          id: "tool-1",
          type: "toolCall",
          tool: "ToolSearch",
          status: "completed",
          result: "found something",
        },
      },
    });

    // message_user delivery (should be visible)
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 7,
      type: "system/manager/user_message",
      scope: threadScope(),
      data: {
        text: "Hello from manager",
        toolCallId: "tool-2",
        turnId: "turn-1",
      },
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 8,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    // User sends a follow-up message (should be visible)
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 9,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ad",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        input: [{ type: "text", text: "Thanks, do the thing" }],
        target: { kind: "new-turn" },
        request: { method: "turn/start", params: {} },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      },
    });

    const agentThreadMessageText = [
      "[bb message from thread:thr_sender123; reply with " +
        '`bb thread tell thr_sender123 "<your response>"`]',
      "",
      "Child thread update",
    ].join("\n");
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 10,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789ae",
        source: "tell",
        initiator: "agent",
        senderThreadId: "thr_sender123",
        input: [{ type: "text", text: agentThreadMessageText }],
        target: { kind: "new-turn" },
        request: { method: "turn/start", params: {} },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      },
    });

    // Default view — should show only operation, message_user, and user message
    const defaultTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      timelineViewMode: "manager-conversation",
    });
    const defaultKinds = defaultTimeline.rows.map((row) =>
      row.kind === "conversation" ? row.role : row.kind,
    );
    expect(defaultKinds).toEqual(["system", "assistant", "user"]);

    // Verify the assistant-text is the message_user output
    const assistantRow = defaultTimeline.rows.find(
      (row) => row.kind === "conversation" && row.role === "assistant",
    );
    expect(assistantRow).toBeDefined();
    if (assistantRow?.kind === "conversation") {
      expect(assistantRow.text).toBe("Hello from manager");
    }
    const defaultSourceRows = flattenTimelineSourceRows(defaultTimeline.rows);
    expect(
      defaultSourceRows.some(
        (row) =>
          row.kind === "conversation" && row.text === "buffered manager delta",
      ),
    ).toBe(false);
    expect(
      defaultSourceRows.some(
        (row) =>
          row.kind === "conversation" && row.text === "[bb system]\n\nWelcome!",
      ),
    ).toBe(false);
    expect(
      defaultSourceRows.some(
        (row) =>
          row.kind === "conversation" &&
          row.text.startsWith("[bb message from thread:"),
      ),
    ).toBe(false);

    // Standard manager timeline uses the same row builder as ordinary threads,
    // while low-value tool discovery rows are still globally suppressed.
    const standardTimeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: false,
    });
    expect(standardTimeline.rows.length).toBeGreaterThan(
      defaultTimeline.rows.length,
    );
    const standardSourceRows = flattenTimelineSourceRows(standardTimeline.rows);
    expect(
      standardSourceRows.some(
        (row) =>
          row.kind === "work" &&
          row.workKind === "tool" &&
          row.toolName === "ToolSearch",
      ),
    ).toBe(false);
    expect(
      standardSourceRows.some(
        (row) =>
          row.kind === "work" &&
          row.workKind === "tool" &&
          row.output.includes("found something"),
      ),
    ).toBe(false);
    expect(standardSourceRows).toContainEqual(
      expect.objectContaining({
        kind: "conversation",
        role: "assistant",
        text: "buffered manager delta",
      }),
    );
    expect(standardSourceRows).toContainEqual(
      expect.objectContaining({
        kind: "conversation",
        role: "user",
        text: "[bb system]\n\nWelcome!",
      }),
    );
    expect(standardSourceRows).toContainEqual(
      expect.objectContaining({
        kind: "conversation",
        role: "user",
        text: agentThreadMessageText,
      }),
    );
  });

  it("surfaces provider and system errors in manager conversation timelines", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "manager",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 1,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: "creq_23456789af",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        input: [{ type: "text", text: "Please coordinate this task" }],
        target: { kind: "new-turn" },
        request: { method: "turn/start", params: {} },
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
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "provider/error",
      data: {
        message: "Provider error",
        detail: "The provider stream closed unexpectedly",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      scope: threadScope(),
      sequence: 4,
      type: "system/error",
      data: {
        code: "thread_command_failed",
        message: "Command turn.submit failed",
        detail: "Payload exceeded provider limit",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: false,
      timelineViewMode: "manager-conversation",
    });
    const sourceRows = flattenTimelineSourceRows(timeline.rows);

    expect(sourceRows).toContainEqual(
      expect.objectContaining({
        kind: "system",
        status: "error",
        systemKind: "error",
        title: "The provider stream closed unexpectedly",
      }),
    );
    expect(sourceRows).toContainEqual(
      expect.objectContaining({
        kind: "system",
        status: "error",
        systemKind: "error",
        title: "Command turn.submit failed",
        detail: "Payload exceeded provider limit",
      }),
    );
  });

  it("shows system client requests only in manager standard timeline details", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const managerThread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      type: "manager",
    });
    const standardThread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      type: "standard",
    });

    for (const thread of [managerThread, standardThread]) {
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: "creq_23456789ab",
          source: "tell",
          initiator: "system",
          senderThreadId: null,
          input: [{ type: "text", text: "system-start-message" }],
          target: { kind: "thread-start" },
          request: { method: "thread/start", params: {} },
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
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "turn/started",
        data: {},
      });
    }

    const defaultTimeline = buildThreadTimeline(harness.db, managerThread, {
      isDevelopment: false,
      timelineViewMode: "manager-conversation",
    });
    expect(JSON.stringify(defaultTimeline.rows)).not.toContain(
      "system-start-message",
    );

    const managerStandardTimeline = buildThreadTimeline(
      harness.db,
      managerThread,
      {
        isDevelopment: false,
      },
    );
    expect(
      flattenTimelineSourceRows(managerStandardTimeline.rows),
    ).toContainEqual(
      expect.objectContaining({
        kind: "conversation",
        role: "user",
        text: "system-start-message",
      }),
    );

    const standardTimeline = buildThreadTimeline(harness.db, standardThread, {
      isDevelopment: false,
    });
    expect(JSON.stringify(standardTimeline.rows)).not.toContain(
      "system-start-message",
    );

    const managerStandardDetails = buildTimelineTurnSummaryDetails(
      harness.db,
      managerThread,
      {
        isDevelopment: false,
        turnId: "turn-1",
        sourceSeqEnd: 2,
        sourceSeqStart: 1,
      },
    );
    expect(
      flattenTimelineSourceRows(managerStandardDetails.rows),
    ).toContainEqual(
      expect.objectContaining({
        kind: "conversation",
        role: "user",
        text: "system-start-message",
      }),
    );

    const defaultDetails = buildTimelineTurnSummaryDetails(
      harness.db,
      managerThread,
      {
        isDevelopment: false,
        turnId: "turn-1",
        sourceSeqEnd: 2,
        sourceSeqStart: 1,
        timelineViewMode: "manager-conversation",
      },
    );
    expect(JSON.stringify(defaultDetails.rows)).not.toContain(
      "system-start-message",
    );
  });

  it("shows system pending steers only for manager standard timelines", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const managerThread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
      type: "manager",
    });
    const standardThread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
      type: "standard",
    });

    for (const thread of [managerThread, standardThread]) {
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 2,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: "creq_23456789ab",
          source: "tell",
          initiator: "system",
          senderThreadId: null,
          input: [{ type: "text", text: "system-pending-steer" }],
          target: { kind: "auto", expectedTurnId: "turn-1" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            permissionMode: "full",
            source: "client/turn/requested",
          },
        },
      });
    }

    const defaultTimeline = buildThreadTimeline(harness.db, managerThread, {
      isDevelopment: false,
      timelineViewMode: "manager-conversation",
    });
    expect(defaultTimeline.rows).not.toContainEqual(
      expect.objectContaining({
        role: "user",
        text: "system-pending-steer",
      }),
    );

    const managerStandardTimeline = buildThreadTimeline(
      harness.db,
      managerThread,
      {
        isDevelopment: false,
      },
    );
    const managerStandardPendingSteerRows = managerStandardTimeline.rows.filter(
      (row) =>
        row.kind === "conversation" &&
        row.role === "user" &&
        row.turnRequest.kind === "steer" &&
        row.turnRequest.status === "pending",
    );
    expect(managerStandardPendingSteerRows).toHaveLength(1);
    expect(managerStandardPendingSteerRows[0]).toMatchObject({
      role: "user",
      text: "system-pending-steer",
      initiator: "system",
      senderThreadId: null,
      turnRequest: {
        kind: "steer",
        status: "pending",
      },
    });

    const standardTimeline = buildThreadTimeline(harness.db, standardThread, {
      isDevelopment: false,
    });
    expect(standardTimeline.rows).not.toContainEqual(
      expect.objectContaining({
        role: "user",
        text: "system-pending-steer",
      }),
    );
  });

  it("keeps manager-visible messages that would otherwise be buried in turn summaries", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const { environmentId, thread } = seedTimelineThread(harness, {
      type: "manager",
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 1,
      type: "turn/started",
      data: {},
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          id: "compact-1",
          type: "contextCompaction",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          id: "compact-1",
          type: "contextCompaction",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      sequence: 4,
      type: "system/manager/user_message",
      scope: threadScope(),
      data: {
        text: "Visible manager update",
        toolCallId: "tool-1",
        turnId: "turn-1",
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 5,
      type: "item/completed",
      data: {
        item: {
          id: "internal-final",
          type: "agentMessage",
          text: "internal final response",
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environmentId,
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      sequence: 6,
      type: "turn/completed",
      data: {
        status: "completed",
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {
      isDevelopment: true,
      timelineViewMode: "manager-conversation",
    });
    const rows = flattenTimelineSourceRows(timeline.rows);

    expect(timeline.rows).toHaveLength(2);
    expect(rows.map((row) => row.kind)).toEqual(["system", "conversation"]);
    expect(rows[0]?.kind).toBe("system");
    if (rows[0]?.kind === "system") {
      expect(rows[0].systemKind).toBe("operation");
      expect(rows[0].title).toBe("Context compacted");
    }
    expect(rows[1]?.kind).toBe("conversation");
    if (rows[1]?.kind === "conversation") {
      expect(rows[1].text).toBe("Visible manager update");
    }
  });
});
