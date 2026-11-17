import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { Thread, ThreadEventItemType, ThreadEventType } from "@bb/domain";
import {
  createProject,
  createThread,
  insertEvents,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { DbConnection, InsertEventInput } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import { buildTimelineTurnSummaryDetails } from "../../../src/services/threads/timeline.js";

const providerThreadId = "provider-root";
const delegation = {
  type: "delegation",
  id: "spawn-reviewer",
  childRef: "child-provider-thread",
  label: "/root/reviewer",
  background: false,
};

function setup(): { db: DbConnection; thread: Thread } {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread };
}

function turnEvent(
  thread: Thread,
  sequence: number,
  turnId: string,
  type: ThreadEventType,
  data: Record<string, unknown>,
  item: { id: string; kind: ThreadEventItemType } | null = null,
  parentToolCallId: string | null = null,
): InsertEventInput {
  return {
    threadId: thread.id,
    sequence,
    type,
    scope: turnScope(turnId),
    providerThreadId,
    itemId: item?.id ?? null,
    itemKind: item?.kind ?? null,
    parentToolCallId,
    data: JSON.stringify({ providerThreadId, ...data }),
  };
}

function insertFailedSubagentTurn(db: DbConnection, thread: Thread): void {
  const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
  const spawn = { id: delegation.id, kind: "delegation" as const };
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: 1,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "spawn",
        initiator: "user",
        request: { method: "thread/start", params: {} },
        requestId,
        senderThreadId: null,
        input: [{ type: "text", text: "Delegate.", mentions: [] }],
        target: { kind: "thread-start" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      }),
    },
    turnEvent(thread, 2, "root-turn", "turn/started", {}),
    turnEvent(thread, 3, "root-turn", "turn/input/accepted", {
      clientRequestId: requestId,
    }),
    turnEvent(
      thread,
      4,
      "root-turn",
      "item/started",
      { item: { ...delegation, status: "pending" } },
      spawn,
    ),
    turnEvent(
      thread,
      5,
      "child-turn",
      "turn/started",
      { parentToolCallId: delegation.id },
      null,
      delegation.id,
    ),
    turnEvent(thread, 6, "child-turn", "provider/warning", {
      category: "general",
      summary: "CHILD_TURN_WARNING",
    }),
    turnEvent(thread, 7, "child-turn", "provider/error", {
      message: "Provider error",
      detail: "CHILD_TURN_ERROR",
      willRetry: false,
    }),
    turnEvent(thread, 8, "child-turn", "turn/completed", {
      status: "failed",
      error: { message: "CHILD_TURN_ERROR" },
    }),
    turnEvent(
      thread,
      9,
      "root-turn",
      "item/completed",
      { item: { ...delegation, status: "failed" } },
      spawn,
    ),
    turnEvent(thread, 10, "root-turn", "turn/completed", {
      status: "completed",
    }),
  ]);
}

function sourceSequences(rows: readonly TimelineRow[]): number[] {
  return rows.flatMap((row) => [
    row.sourceSeqStart,
    ...sourceSequences(
      row.kind === "work" && row.workKind === "delegation"
        ? (row.childRows ?? [])
        : [],
    ),
  ]);
}

describe("delegated turn details", () => {
  it("loads a subagent turn's warnings and errors that carry no parent call id", () => {
    const { db, thread } = setup();
    insertFailedSubagentTurn(db, thread);

    const details = buildTimelineTurnSummaryDetails(db, thread, {
      completedTurnDisplay: "collapse",
      deferContent: false,
      includeDiagnosticOperations: false,
      itemId: delegation.id,
      sourceSeqEnd: 10,
      sourceSeqStart: 2,
      summarizeShellCommands: true,
      turnId: "root-turn",
    });

    expect(sourceSequences(details.rows)).toEqual([4, 6, 7]);
  });
});
