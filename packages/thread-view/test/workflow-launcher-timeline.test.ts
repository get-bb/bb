import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "../src/index.js";

function launchEvents(options: {
  nested: boolean;
  completionOnly: boolean;
  running: boolean;
}): ThreadEventWithMeta[] {
  const scope = turnScope("turn-1");
  const parent = options.nested ? { parentToolCallId: "review-call" } : {};
  const events: ThreadEvent[] = [
    {
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope,
    },
    ...(options.nested
      ? [
          {
            type: "item/completed" as const,
            threadId: "thread-1",
            providerThreadId: "provider-1",
            scope,
            item: {
              type: "toolCall" as const,
              id: "review-call",
              tool: "Agent",
              arguments: { description: "Review" },
              status: "completed" as const,
            },
          },
        ]
      : []),
    {
      type: "item/completed",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope,
      item: {
        type: "toolCall",
        id: "launch-call",
        tool: "Workflow",
        arguments: {},
        result: "Background task started",
        status: "completed",
        ...parent,
      },
    },
    {
      type: options.completionOnly
        ? "item/backgroundTask/completed"
        : options.running
          ? "item/started"
          : "item/completed",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: options.completionOnly ? threadScope() : scope,
      item: {
        type: "backgroundTask",
        id: "task:workflow-1",
        parentToolCallId: "launch-call",
        taskType: "local_workflow",
        workflowName: "projection-check",
        description: "Review source",
        status: options.running ? "pending" : "completed",
        taskStatus: options.running ? "running" : "completed",
        skipTranscript: false,
        foreground: false,
        workflow: {
          phases: [{ index: 1, title: "Inspect" }],
          agents: [
            {
              index: 1,
              label: "reader",
              state: options.running ? "running" : "done",
              model: "haiku",
              attempt: 1,
              cached: false,
              lastProgressAt: 3_000,
              phaseIndex: 1,
              phaseTitle: "Inspect",
            },
          ],
        },
      },
    },
    {
      type: "item/completed",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope,
      item: {
        type: "agentMessage",
        id: "answer",
        text: "Review finished",
        ...parent,
      },
    },
    {
      type: "turn/completed",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope,
      status: "completed",
    },
  ];
  if (options.completionOnly) {
    const taskIndex = events.findIndex(
      (event) => event.type === "item/backgroundTask/completed",
    );
    const [completion] = events.splice(taskIndex, 1);
    if (completion) events.push(completion);
  }
  return events.map((event, index) => ({
    event,
    meta: { id: `event-${index}`, seq: index + 1, createdAt: index * 1_000 },
  }));
}

function expandTurns(rows: TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" && row.children ? expandTurns(row.children) : [row],
  );
}

describe("workflow launcher timeline", () => {
  for (const completedTurnDisplay of ["flat", "collapse"] as const) {
    for (const nested of [false, true]) {
      it.each([
        { completionOnly: false, running: true },
        { completionOnly: false, running: false },
        { completionOnly: true, running: false },
      ])(
        `keeps a workflow beside its launcher (${completedTurnDisplay}, nested=${nested}, %j)`,
        (lifecycle) => {
          const result = buildThreadTimelineFromEvents({
            acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
            contextWindowEvents: [],
            events: launchEvents({ nested, ...lifecycle }),
            options: {
              completedTurnDisplay,
              includeNestedRows: true,
              includeDiagnosticOperations: false,
              summarizeShellCommands: true,
              isLatestPage: true,
              threadStatus: "idle",
              threadName: "",
              workspaceRoot: null,
            },
          });
          const rootRows = expandTurns(result.rows);
          const delegation = rootRows.find(
            (row) => row.kind === "work" && row.workKind === "delegation",
          );
          if (nested) {
            expect(delegation).toMatchObject({ callId: "review-call" });
          } else {
            expect(delegation).toBeUndefined();
          }
          const rows =
            nested &&
            delegation?.kind === "work" &&
            delegation.workKind === "delegation"
              ? expandTurns(delegation.childRows ?? [])
              : rootRows;
          const launchIndex = rows.findIndex(
            (row) =>
              row.kind === "work" &&
              row.workKind === "tool" &&
              row.callId === "launch-call",
          );
          expect(launchIndex).toBeGreaterThanOrEqual(0);
          expect(rows[launchIndex + 1]).toMatchObject({
            kind: "work",
            workKind: "workflow",
            itemId: "task:workflow-1",
            turnId: "turn-1",
            workflowName: "projection-check",
            taskStatus: lifecycle.running ? "running" : "completed",
            workflow: {
              agents: [expect.objectContaining({ label: "reader" })],
            },
          });
          expect(
            rows.filter(
              (row) => row.kind === "work" && row.workKind === "workflow",
            ),
          ).toHaveLength(1);
        },
      );
    }
  }
});
