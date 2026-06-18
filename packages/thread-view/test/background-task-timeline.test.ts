import { threadScope, turnScope } from "@bb/domain";
import type {
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import type { TimelineRow, TimelineWorkflowWorkRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildThreadTimelineFromEvents,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadTimelineFromEventsResult,
  type ThreadEventWithMeta,
} from "../src/index.js";

function withMeta(event: ThreadEvent, seq: number): ThreadEventWithMeta {
  return {
    event,
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq * 1_000,
    },
  };
}

function buildTimeline(
  events: ThreadEventWithMeta[],
  options: {
    includeNestedRows?: boolean;
    turnMessageDetail?: "summary" | "full";
  } = {},
): ThreadTimelineFromEventsResult {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events,
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: options.includeNestedRows ?? true,
      includeProviderUnhandledOperations: false,
      isLatestPage: true,
      threadStatus: "idle",
      threadName: "",
      turnMessageDetail: options.turnMessageDetail ?? "full",
      workspaceRoot: null,
    },
  });
}

function buildTimelineRows(events: ThreadEventWithMeta[]): TimelineRow[] {
  return buildTimeline(events).rows;
}

function findWorkflowRows(rows: TimelineRow[]): TimelineWorkflowWorkRow[] {
  const found: TimelineWorkflowWorkRow[] = [];
  for (const row of rows) {
    if (row.kind === "work" && row.workKind === "workflow") {
      found.push(row);
    }
    if (row.kind === "turn" && row.children) {
      found.push(...findWorkflowRows(row.children));
    }
  }
  return found;
}

function taskItem(args: {
  taskStatus: ThreadEventBackgroundTaskItem["taskStatus"];
  status: ThreadEventBackgroundTaskItem["status"];
  workflow?: WorkflowProgressSnapshot;
  skipTranscript?: boolean;
  summary?: string;
}): ThreadEventBackgroundTaskItem {
  return {
    type: "backgroundTask",
    id: "task:wf-1",
    taskType: "local_workflow",
    description: "Tiny fixture workflow",
    status: args.status,
    taskStatus: args.taskStatus,
    skipTranscript: args.skipTranscript ?? false,
    workflowName: "fixture-mini",
    ...(args.workflow ? { workflow: args.workflow } : {}),
    ...(args.summary ? { summary: args.summary } : {}),
    usage: { totalTokens: 26674, toolUses: 0, durationMs: 3277 },
  };
}

const RUNNING_SNAPSHOT: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Scan" },
    { index: 2, title: "Summarize" },
  ],
  agents: [
    {
      index: 1,
      label: "alpha",
      state: "done",
      model: "claude-haiku-4-5",
      attempt: 1,
      cached: false,
      lastProgressAt: 1,
      phaseIndex: 1,
      phaseTitle: "Scan",
    },
    {
      index: 2,
      label: "bravo",
      state: "running",
      model: "claude-haiku-4-5",
      attempt: 1,
      cached: false,
      lastProgressAt: 2,
      phaseIndex: 1,
      phaseTitle: "Scan",
    },
  ],
};

const DONE_SNAPSHOT: WorkflowProgressSnapshot = {
  ...RUNNING_SNAPSHOT,
  agents: RUNNING_SNAPSHOT.agents.map((agent) => ({
    ...agent,
    state: "done" as const,
  })),
};

function turnStarted(turnId: string, seq: number): ThreadEventWithMeta {
  return withMeta(
    {
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: turnScope(turnId),
    },
    seq,
  );
}

function turnCompleted(turnId: string, seq: number): ThreadEventWithMeta {
  return withMeta(
    {
      type: "turn/completed",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: turnScope(turnId),
      status: "completed",
    },
    seq,
  );
}

describe("background task timeline projection", () => {
  it("folds started → progress → completed into one workflow row", () => {
    const rows = buildTimelineRows([
      turnStarted("turn-1", 1),
      withMeta(
        {
          type: "item/started",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          item: taskItem({ status: "pending", taskStatus: "running" }),
        },
        2,
      ),
      withMeta(
        {
          type: "item/backgroundTask/progress",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: threadScope(),
          item: taskItem({
            status: "pending",
            taskStatus: "running",
            workflow: RUNNING_SNAPSHOT,
          }),
        },
        3,
      ),
      withMeta(
        {
          type: "item/backgroundTask/completed",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: threadScope(),
          item: taskItem({
            status: "completed",
            taskStatus: "completed",
            workflow: DONE_SNAPSHOT,
            summary: "Dynamic workflow completed",
          }),
        },
        4,
      ),
    ]);

    const workflowRows = findWorkflowRows(rows);
    expect(workflowRows).toHaveLength(1);
    const row = workflowRows[0]!;
    expect(row).toMatchObject({
      workKind: "workflow",
      status: "completed",
      taskStatus: "completed",
      workflowName: "fixture-mini",
      summary: "Dynamic workflow completed",
      usage: { totalTokens: 26674, toolUses: 0, durationMs: 3277 },
    });
    expect(row.workflow?.agents.map((agent) => agent.state)).toEqual([
      "done",
      "done",
    ]);
    expect(row.completedAt).not.toBeNull();
  });

  it("keeps one row when completion arrives turns after the spawning turn", () => {
    const rows = buildTimelineRows([
      turnStarted("turn-1", 1),
      withMeta(
        {
          type: "item/started",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          item: taskItem({ status: "pending", taskStatus: "running" }),
        },
        2,
      ),
      turnCompleted("turn-1", 3),
      turnStarted("turn-2", 4),
      turnCompleted("turn-2", 5),
      withMeta(
        {
          type: "item/backgroundTask/completed",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: threadScope(),
          item: taskItem({
            status: "interrupted",
            taskStatus: "stopped",
            workflow: RUNNING_SNAPSHOT,
          }),
        },
        6,
      ),
    ]);

    const workflowRows = findWorkflowRows(rows);
    expect(workflowRows).toHaveLength(1);
    expect(workflowRows[0]).toMatchObject({
      status: "interrupted",
      taskStatus: "stopped",
    });
  });

  it("keeps the spawning turn's source range pinned when task events arrive after later turns", () => {
    const rows = buildTimelineRows([
      turnStarted("turn-1", 1),
      withMeta(
        {
          type: "item/started",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          item: taskItem({ status: "pending", taskStatus: "running" }),
        },
        2,
      ),
      turnCompleted("turn-1", 3),
      turnStarted("turn-2", 4),
      turnCompleted("turn-2", 5),
      withMeta(
        {
          type: "item/backgroundTask/completed",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: threadScope(),
          item: taskItem({
            status: "completed",
            taskStatus: "completed",
            workflow: DONE_SNAPSHOT,
            summary: "Dynamic workflow completed",
          }),
        },
        6,
      ),
    ]);

    // The late thread-scoped completion (seq 6) must not stretch turn-1's
    // source range past turn-2's rows: the server validates turn-summary
    // expansion against that range and rejects ranges containing other
    // turns' rows, which would permanently break expanding turn-1.
    const spawningTurnRow = rows.find(
      (row) => row.kind === "turn" && row.turnId === "turn-1",
    );
    expect(spawningTurnRow).toMatchObject({
      sourceSeqStart: 1,
      sourceSeqEnd: 3,
    });

    // The workflow row itself stays anchored at its item/started event while
    // still folding the late terminal payload.
    const workflowRows = findWorkflowRows(rows);
    expect(workflowRows).toHaveLength(1);
    expect(workflowRows[0]).toMatchObject({
      sourceSeqStart: 2,
      sourceSeqEnd: 2,
      status: "completed",
      taskStatus: "completed",
      summary: "Dynamic workflow completed",
    });
  });

  it("renders the degraded row when no workflow_progress was reported", () => {
    const rows = buildTimelineRows([
      turnStarted("turn-1", 1),
      withMeta(
        {
          type: "item/started",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          item: taskItem({ status: "pending", taskStatus: "running" }),
        },
        2,
      ),
    ]);

    const workflowRows = findWorkflowRows(rows);
    expect(workflowRows).toHaveLength(1);
    expect(workflowRows[0]).toMatchObject({
      status: "pending",
      workflow: null,
      description: "Tiny fixture workflow",
    });
  });

  it("surfaces an active workflow when the spawning turn is summarized", () => {
    const timeline = buildTimeline(
      [
        turnStarted("turn-1", 1),
        withMeta(
          {
            type: "item/started",
            threadId: "thread-1",
            providerThreadId: "provider-1",
            scope: turnScope("turn-1"),
            item: taskItem({ status: "pending", taskStatus: "running" }),
          },
          2,
        ),
        turnCompleted("turn-1", 3),
        withMeta(
          {
            type: "item/backgroundTask/progress",
            threadId: "thread-1",
            providerThreadId: "provider-1",
            scope: threadScope(),
            item: taskItem({
              status: "pending",
              taskStatus: "running",
              workflow: RUNNING_SNAPSHOT,
            }),
          },
          4,
        ),
      ],
      { includeNestedRows: false, turnMessageDetail: "summary" },
    );

    expect(findWorkflowRows(timeline.rows)).toHaveLength(0);
    expect(timeline.activeWorkflow).toMatchObject({
      itemId: "task:wf-1",
      status: "pending",
      taskStatus: "running",
      workflowName: "fixture-mini",
    });
  });

  it("hides skip_transcript tasks from the timeline", () => {
    const timeline = buildTimeline([
      turnStarted("turn-1", 1),
      withMeta(
        {
          type: "item/started",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          item: taskItem({
            status: "pending",
            taskStatus: "running",
            skipTranscript: true,
          }),
        },
        2,
      ),
    ]);

    expect(findWorkflowRows(timeline.rows)).toHaveLength(0);
    expect(timeline.activeWorkflow).toBeNull();
  });
});
