import { mapTimelineRowTree, type TimelineRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildThreadTimelineFromEvents } from "../src/index.js";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  createTimelineEventFactory,
  fromRows,
} from "./timeline-test-harness.js";

function delegationEvents() {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  const agent = (itemId: string, turnId: string, seq: number) =>
    event.toolCallStarted({
      seq,
      itemId,
      turnId,
      tool: "Agent",
      arguments: { description: `Run ${itemId}`, subagent_type: "reviewer" },
    });
  const done = (itemId: string, turnId: string, seq: number) =>
    event.toolCallCompleted({
      seq,
      itemId,
      turnId,
      tool: "Agent",
      result: "done",
    });
  const child = (parentToolCallId: string, turnId: string, seq: number) =>
    event.assistantCompleted({
      seq,
      itemId: `${parentToolCallId}-text`,
      turnId,
      parentToolCallId,
      text: `Child of ${parentToolCallId}`,
    });
  return fromRows([
    event.turnStarted({ seq: 1, turnId: "turn-1" }),
    agent("nested-settled", "turn-1", 2),
    child("nested-settled", "turn-1", 3),
    done("nested-settled", "turn-1", 4),
    event.turnCompleted({ seq: 5, turnId: "turn-1", status: "completed" }),
    event.turnStarted({ seq: 6, turnId: "turn-2" }),
    agent("settled", "turn-2", 7),
    child("settled", "turn-2", 8),
    done("settled", "turn-2", 9),
    agent("childless", "turn-2", 10),
    done("childless", "turn-2", 11),
    agent("running", "turn-2", 12),
    child("running", "turn-2", 13),
  ]);
}

function build(omitSettledDelegationChildRows: boolean): TimelineRow[] {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events: delegationEvents(),
    options: {
      completedTurnDisplay: "collapse",
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      isLatestPage: true,
      omitSettledDelegationChildRows,
      summarizeShellCommands: true,
      threadName: "",
      threadStatus: "active",
      workspaceRoot: null,
    },
  }).rows;
}

function dropSettledDelegationChildRows(rows: TimelineRow[]): TimelineRow[] {
  return mapTimelineRowTree(rows, (row) =>
    row.kind === "work" &&
    row.workKind === "delegation" &&
    row.childRows !== null &&
    row.childRows.length > 0 &&
    row.turnId !== null &&
    row.status !== "pending"
      ? { ...row, childRows: null }
      : row,
  );
}

function delegations(rows: readonly TimelineRow[]): Map<string, TimelineRow> {
  const found = new Map<string, TimelineRow>();
  for (const row of rows) {
    if (row.kind === "work" && row.workKind === "delegation") {
      found.set(row.callId, row);
      for (const [id, nested] of delegations(row.childRows ?? [])) {
        found.set(id, nested);
      }
    }
    if (row.kind === "turn") {
      for (const [id, nested] of delegations(row.children ?? [])) {
        found.set(id, nested);
      }
    }
  }
  return found;
}

describe("settled delegation child rows", () => {
  it("omits them exactly as deferring the full rows would", () => {
    const full = build(false);
    const omitted = build(true);
    expect(JSON.stringify(omitted)).toBe(
      JSON.stringify(dropSettledDelegationChildRows(full)),
    );
    const byCallId = delegations(omitted);
    expect(byCallId.get("nested-settled")).toMatchObject({ childRows: null });
    expect(byCallId.get("settled")).toMatchObject({ childRows: null });
    expect(byCallId.get("childless")).toMatchObject({ childRows: [] });
    expect(byCallId.get("running")).toMatchObject({
      status: "pending",
      childRows: [
        expect.objectContaining({
          kind: "conversation",
          text: "Child of running",
        }),
      ],
    });
  });
});
