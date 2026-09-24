import { describe, expect, it } from "vitest";
import { turnScope, type Thread } from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  listStoredTimelineTurnEventRows,
  listTimelineWindowItemIds,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import {
  buildThreadTimelineWithProfile,
  buildTimelineTurnSummaryDetails,
} from "../../../src/services/threads/timeline.js";

function fixture(splitTurn = false) {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "claude-code",
    status: "idle",
  });
  let sequence = 0;
  const add = (
    type: Parameters<typeof insertEvents>[2][number]["type"],
    data: object,
    itemId: string | null = null,
    itemKind:
      | "commandExecution"
      | "agentMessage"
      | "contextCompaction"
      | null = null,
    turnId = "turn",
  ) => {
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        providerThreadId: "provider",
        scope: turnScope(turnId),
        sequence: ++sequence,
        type,
        data: JSON.stringify(data),
        itemId,
        itemKind,
        parentToolCallId: null,
      },
    ]);
  };
  const command = (id: string, output: string) => ({
    item: {
      type: "commandExecution",
      id,
      command: "cat README.md",
      cwd: "/tmp/test",
      status: "completed",
      approvalStatus: null,
      aggregatedOutput: output,
    },
  });
  if (splitTurn) {
    add("turn/started", {}, null, null, "overlap");
    add(
      "item/completed",
      {
        item: {
          type: "agentMessage",
          id: "unrelated-answer",
          text: "Other task",
        },
      },
      "unrelated-answer",
      "agentMessage",
      "overlap",
    );
    for (let index = 0; index < 100; index++) {
      const id = `overlap-${index}`;
      add(
        "item/completed",
        command(id, "unrelated output"),
        id,
        "commandExecution",
        "overlap",
      );
    }
  }
  add("turn/started", {});
  for (let index = 0; index < 100; index++) {
    const id = `command-${index}`;
    add(
      "item/completed",
      command(id, "hidden output\n".repeat(500)),
      id,
      "commandExecution",
    );
  }
  add(
    "item/completed",
    { item: { type: "agentMessage", id: "answer", text: "Done" } },
    "answer",
    "agentMessage",
  );
  if (splitTurn) {
    add(
      "item/completed",
      { item: { type: "agentMessage", id: "next", text: "Next task" } },
      "next",
      "agentMessage",
    );
    add(
      "item/commandExecution/outputDelta",
      { itemId: "command-0", delta: "late output" },
      "command-0",
    );
    add(
      "item/completed",
      { item: { type: "contextCompaction", id: "compact-1" } },
      "compact-1",
      "contextCompaction",
    );
    add(
      "item/completed",
      command("selected", "selected output"),
      "selected",
      "commandExecution",
    );
    add(
      "item/completed",
      command("overlap-0", "late completion"),
      "overlap-0",
      "commandExecution",
      "overlap",
    );
    add(
      "item/completed",
      command("selected-tail", "tail output"),
      "selected-tail",
      "commandExecution",
    );
    add(
      "item/completed",
      { item: { type: "agentMessage", id: "final", text: "Finished" } },
      "final",
      "agentMessage",
    );
    add(
      "item/completed",
      { item: { type: "contextCompaction", id: "compact-2" } },
      "compact-2",
      "contextCompaction",
    );
    add("turn/completed", { status: "completed" }, null, null, "overlap");
  }
  add(
    "item/completed",
    command("trailing", "visible output\n".repeat(100)),
    "trailing",
    "commandExecution",
  );
  add("turn/completed", { status: "completed" });
  return { db, thread };
}

function build(
  db: DbConnection,
  thread: Thread,
  includeNestedRows: boolean,
  responseByteBudget = 20_000_000,
) {
  return buildThreadTimelineWithProfile(db, thread, {
    completedTurnDisplay: "collapse",
    includeDiagnosticOperations: false,
    includeNestedRows,
    eventBudget: 1500,
    maxInlineOutputChars: 32_000,
    maxSeq: 0,
    page: { kind: "latest", segmentLimit: 8 },
    responseByteBudget,
  });
}

describe("timeline command output selection", () => {
  it("expands a small group without selecting unrelated command history", () => {
    const { db, thread } = fixture(true);
    try {
      const expanded = build(db, thread, true).response;
      const summary = expanded.rows.find(
        (row) =>
          row.kind === "turn" &&
          row.children?.some(
            (child) =>
              child.kind === "work" &&
              child.workKind === "command" &&
              child.callId === "selected",
          ),
      );
      if (summary?.kind !== "turn" || summary.turnId === null)
        throw new Error("Missing selected summary");
      const details = buildTimelineTurnSummaryDetails(db, thread, {
        turnId: summary.turnId,
        sourceSeqStart: summary.sourceSeqStart,
        sourceSeqEnd: summary.sourceSeqEnd,
        completedTurnDisplay: "collapse",
        includeDiagnosticOperations: false,
      });
      expect(details.rows).toEqual(summary.children);
      const context = listStoredTimelineTurnEventRows(db, {
        threadId: thread.id,
        turnIds: [summary.turnId, "overlap"],
        sequenceStart: 0,
        beforeSequence: 1000,
        maxInlineOutputChars: null,
        itemContext: {
          turnIds: [summary.turnId],
          itemIds: listTimelineWindowItemIds(db, {
            turnIds: [summary.turnId],
            threadId: thread.id,
            sequenceStart: summary.sourceSeqStart,
            beforeSequence: summary.sourceSeqEnd + 1,
            maxInlineOutputChars: null,
          }),
          sequenceStart: summary.sourceSeqStart,
          beforeSequence: summary.sourceSeqEnd + 1,
        },
      });
      expect(
        context
          .filter((row) => row.itemKind === "commandExecution")
          .map((row) => row.itemId),
      ).toEqual(["command-0", "selected", "selected-tail"]);
      expect(
        context.filter((row) => row.itemKind === "contextCompaction"),
      ).toHaveLength(2);
      expect(
        context
          .filter(
            (row) => row.turnId === "overlap" && !row.type.startsWith("item/"),
          )
          .map((row) => row.type),
      ).toEqual(["turn/started", "turn/completed"]);
      expect(
        context.filter((row) => row.itemKind === "agentMessage"),
      ).toHaveLength(3);
    } finally {
      db.$client.close();
    }
  });

  it("omits hidden payloads while preserving visible output, summary bounds, and expansion", () => {
    const { db, thread } = fixture();
    try {
      const collapsed = build(db, thread, false);
      const expanded = build(db, thread, true);
      expect(collapsed.response.rows).toEqual(
        expanded.response.rows.map((row) =>
          row.kind === "turn" ? { ...row, children: null } : row,
        ),
      );
      expect(collapsed.profile.eventDataBytes).toBeLessThan(
        expanded.profile.eventDataBytes / 5,
      );
      const summary = expanded.response.rows.find((row) => row.kind === "turn");
      if (summary?.kind !== "turn" || summary.turnId === null)
        throw new Error("Missing summary");
      const details = buildTimelineTurnSummaryDetails(db, thread, {
        turnId: summary.turnId,
        sourceSeqStart: summary.sourceSeqStart,
        sourceSeqEnd: summary.sourceSeqEnd,
        completedTurnDisplay: "collapse",
        includeDiagnosticOperations: false,
      });
      expect(details.rows).toEqual(summary.children);
      const visible = collapsed.response.rows.find(
        (row) => row.kind === "work" && row.workKind === "command",
      );
      expect(visible).toMatchObject({ output: "visible output\n".repeat(100) });
    } finally {
      db.$client.close();
    }
  });

  it("hydrates visible payloads before applying the response byte budget", () => {
    const { db, thread } = fixture();
    try {
      const collapsed = build(db, thread, false, 1000).response;
      const full = build(
        db,
        { ...thread, status: "active" },
        false,
        1000,
      ).response;
      expect(collapsed.rows).toEqual(full.rows);
      expect(collapsed.timelinePage.hasOlderRows).toEqual(
        full.timelinePage.hasOlderRows,
      );
      expect(collapsed.timelinePage.olderCursor?.anchorSeq).toEqual(
        full.timelinePage.olderCursor?.anchorSeq,
      );
      expect(collapsed.timelinePage.contentPage).toEqual(
        full.timelinePage.contentPage,
      );
    } finally {
      db.$client.close();
    }
  });
});
