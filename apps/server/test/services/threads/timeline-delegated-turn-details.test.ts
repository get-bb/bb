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
import { sql } from "drizzle-orm";
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

function command(
  id: string,
  status: "pending" | "completed",
  parentToolCallId: string,
) {
  return {
    item: {
      type: "commandExecution",
      id,
      parentToolCallId,
      command: `run ${id}`,
      cwd: "/tmp/test",
      status,
      approvalStatus: null,
      ...(status === "completed"
        ? { exitCode: 0, aggregatedOutput: `${id} output` }
        : {}),
    },
  };
}

function spawn(
  id: string,
  status: "pending" | "completed",
  parentToolCallId: string | null = null,
) {
  return {
    item: {
      type: "delegation",
      id,
      ...(parentToolCallId === null ? {} : { parentToolCallId }),
      childRef: `${id}-child`,
      label: `/root/${id}`,
      background: false,
      status,
    },
  };
}

function itemDetails(
  db: DbConnection,
  thread: Thread,
  range: { itemId: string; sourceSeqEnd: number; sourceSeqStart: number },
): TimelineRow[] {
  return buildTimelineTurnSummaryDetails(db, thread, {
    completedTurnDisplay: "collapse",
    deferContent: true,
    includeDiagnosticOperations: false,
    summarizeShellCommands: true,
    turnId: "root-turn",
    ...range,
  }).rows;
}

function workStatus(row: TimelineRow): string | null {
  return row.kind === "work" ? row.status : null;
}

function flattenRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => [
    row,
    ...flattenRows(
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
  it("loads a running subagent turn's later warnings when the delegation is requested by id", () => {
    const { db, thread } = setup();
    insertFailedSubagentTurn(db, thread);
    db.run(sql`DELETE FROM events WHERE sequence > 7`);

    const details = buildTimelineTurnSummaryDetails(
      db,
      { ...thread, status: "active" },
      {
        completedTurnDisplay: "collapse",
        deferContent: false,
        includeDiagnosticOperations: false,
        itemId: delegation.id,
        sourceSeqEnd: 7,
        sourceSeqStart: 2,
        summarizeShellCommands: true,
        turnId: "root-turn",
      },
    );

    expect(sourceSequences(details.rows)).toEqual([4, 6, 7]);
  });

  it("finds a command nested two subagents deep from the outer subagent's range", () => {
    const { db, thread } = setup();
    const outer = { id: "outer", kind: "delegation" as const };
    const inner = { id: "inner", kind: "delegation" as const };
    const nested = { id: "nested-command", kind: "commandExecution" as const };
    const sibling = {
      id: "sibling-command",
      kind: "commandExecution" as const,
    };
    insertEvents(db, noopNotifier, [
      turnEvent(thread, 1, "root-turn", "turn/started", {}),
      turnEvent(
        thread,
        2,
        "root-turn",
        "item/started",
        spawn("outer", "pending"),
        outer,
      ),
      turnEvent(
        thread,
        3,
        "root-turn",
        "item/started",
        spawn("inner", "pending", "outer"),
        inner,
        "outer",
      ),
      turnEvent(
        thread,
        4,
        "root-turn",
        "item/started",
        command("nested-command", "pending", "inner"),
        nested,
        "inner",
      ),
      turnEvent(
        thread,
        5,
        "root-turn",
        "item/completed",
        command("nested-command", "completed", "inner"),
        nested,
        "inner",
      ),
      turnEvent(
        thread,
        6,
        "root-turn",
        "item/completed",
        spawn("inner", "completed", "outer"),
        inner,
        "outer",
      ),
      turnEvent(
        thread,
        7,
        "root-turn",
        "item/started",
        command("sibling-command", "pending", "outer"),
        sibling,
        "outer",
      ),
      turnEvent(
        thread,
        8,
        "root-turn",
        "item/completed",
        command("sibling-command", "completed", "outer"),
        sibling,
        "outer",
      ),
      turnEvent(
        thread,
        9,
        "root-turn",
        "item/completed",
        spawn("outer", "completed"),
        outer,
      ),
    ]);

    const rows = itemDetails(db, thread, {
      itemId: "nested-command",
      sourceSeqEnd: 9,
      sourceSeqStart: 2,
    });

    expect(
      rows.map((row) => [row.id, row.sourceSeqStart, row.sourceSeqEnd]),
    ).toEqual([
      [
        `${thread.id}:delegation:outer:child:${thread.id}:delegation:inner:child:${thread.id}:command:nested-command`,
        4,
        5,
      ],
    ]);
  });

  it("keeps a subagent command whose completion names a different parent", () => {
    const { db, thread } = setup();
    const outer = { id: "outer", kind: "delegation" as const };
    const child = { id: "child-command", kind: "commandExecution" as const };
    insertEvents(db, noopNotifier, [
      turnEvent(thread, 1, "root-turn", "turn/started", {}),
      turnEvent(
        thread,
        2,
        "root-turn",
        "item/started",
        spawn("outer", "pending"),
        outer,
      ),
      turnEvent(
        thread,
        3,
        "root-turn",
        "item/completed",
        spawn("outer", "completed"),
        outer,
      ),
      turnEvent(
        thread,
        4,
        "root-turn",
        "item/started",
        command("child-command", "pending", "outer"),
        child,
        "outer",
      ),
      turnEvent(
        thread,
        5,
        "root-turn",
        "item/completed",
        command("child-command", "completed", "other-parent"),
        child,
        "other-parent",
      ),
    ]);

    const rows = flattenRows(
      itemDetails(db, thread, {
        itemId: "outer",
        sourceSeqEnd: 5,
        sourceSeqStart: 2,
      }),
    );

    expect(
      rows.map((row) => [row.id, workStatus(row), row.sourceSeqEnd]),
    ).toEqual([
      [`${thread.id}:delegation:outer`, "completed", 5],
      [
        `${thread.id}:delegation:outer:child:${thread.id}:command:child-command`,
        "completed",
        5,
      ],
    ]);
  });

  it("finds a command in a running child turn from the root turn's subagent range", () => {
    const { db, thread } = setup();
    const spawnItem = { id: delegation.id, kind: "delegation" as const };
    const child = { id: "child-command", kind: "commandExecution" as const };
    insertEvents(db, noopNotifier, [
      turnEvent(thread, 1, "root-turn", "turn/started", {}),
      turnEvent(
        thread,
        2,
        "root-turn",
        "item/started",
        { item: { ...delegation, status: "pending" } },
        spawnItem,
      ),
      turnEvent(
        thread,
        3,
        "child-turn",
        "turn/started",
        { parentToolCallId: delegation.id },
        null,
        delegation.id,
      ),
      turnEvent(
        thread,
        4,
        "child-turn",
        "item/started",
        command("child-command", "pending", delegation.id),
        child,
        delegation.id,
      ),
      turnEvent(
        thread,
        5,
        "child-turn",
        "item/completed",
        command("child-command", "completed", delegation.id),
        child,
        delegation.id,
      ),
    ]);

    const rows = itemDetails(
      db,
      { ...thread, status: "active" },
      { itemId: "child-command", sourceSeqEnd: 5, sourceSeqStart: 2 },
    );

    expect(
      rows.map((row) => [row.id, workStatus(row), row.sourceSeqStart]),
    ).toEqual([
      [
        `${thread.id}:delegation:${delegation.id}:child:${thread.id}:command:child-command`,
        "completed",
        4,
      ],
    ]);
  });
});
