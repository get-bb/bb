import { afterEach, describe, expect, it } from "vitest";
import { threadScope, turnScope, type ThreadEventType } from "@bb/domain";
import type { DbConnection } from "../../src/connection.js";
import {
  appendDaemonEventsInTransaction,
  insertEvents,
  listAppendedEventRows,
  listStoredEventRowsInSequenceRange,
  listStoredTimelineWindowEventRows,
  selectAppendedTimelineWindowRows,
  type InsertEventInput,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

let db: DbConnection;

afterEach(() => {
  db.$client.close();
});

function setup(): string {
  db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "appended-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "appended-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/appended" },
  });
  return createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  }).id;
}

function event(
  threadId: string,
  sequence: number,
  type: ThreadEventType,
  data: Record<string, unknown>,
): InsertEventInput {
  return {
    data: JSON.stringify(data),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    scope: type.startsWith("item/") ? turnScope("turn-1") : threadScope(),
    sequence,
    threadId,
    type,
  };
}

function commandCompleted(
  threadId: string,
  sequence: number,
  output: string,
): InsertEventInput {
  return {
    ...event(threadId, sequence, "item/completed", {
      item: {
        aggregatedOutput: output,
        command: "ls",
        id: `cmd-${sequence}`,
        status: "completed",
        type: "commandExecution",
      },
    }),
    itemId: `cmd-${sequence}`,
    itemKind: "commandExecution",
  };
}

const range = (threadId: string, maxInlineOutputChars: number | null) => ({
  afterSequence: 0,
  limit: 100,
  maxInlineOutputChars,
  threadId,
  throughSequence: 100,
});

describe("listAppendedEventRows", () => {
  it("serves committed rows from memory exactly as the database returns them", () => {
    const threadId = setup();
    insertEvents(db, noopNotifier, [
      event(threadId, 1, "system/manager/user_message", { text: "one" }),
      commandCompleted(threadId, 2, "short output"),
    ]);

    const first = listAppendedEventRows(db, range(threadId, 32_000));
    const second = listAppendedEventRows(db, range(threadId, 32_000));

    expect(first).toEqual(
      listStoredEventRowsInSequenceRange(db, range(threadId, 32_000)),
    );
    expect(second[1]).toBe(first[1]);
  });

  it("reads rows back when their transaction rolled back", () => {
    const threadId = setup();
    expect(() =>
      db.transaction((tx) => {
        appendDaemonEventsInTransaction(tx, [
          {
            data: JSON.stringify({ text: "rolled back" }),
            environmentId: null,
            itemId: null,
            itemKind: null,
            parentToolCallId: null,
            providerThreadId: null,
            scope: threadScope(),
            threadId,
            type: "system/manager/user_message",
          },
        ]);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    insertEvents(db, noopNotifier, [
      event(threadId, 1, "system/manager/user_message", { text: "kept" }),
    ]);

    const rows = listAppendedEventRows(db, range(threadId, 32_000));

    expect(rows).toEqual(
      listStoredEventRowsInSequenceRange(db, range(threadId, 32_000)),
    );
    expect(JSON.parse(rows[0]!.data)).toEqual({ text: "kept" });
  });

  it("reads back a row the inline output limit truncates", () => {
    const threadId = setup();
    insertEvents(db, noopNotifier, [
      commandCompleted(threadId, 1, "x".repeat(400)),
    ]);

    const rows = listAppendedEventRows(db, range(threadId, 200));

    expect(rows).toEqual(
      listStoredEventRowsInSequenceRange(db, range(threadId, 200)),
    );
    expect(rows[0]!.data).toContain("more characters truncated]");
  });
});

describe("selectAppendedTimelineWindowRows", () => {
  it("matches the timeline window query for the appended range", () => {
    const threadId = setup();
    insertEvents(db, noopNotifier, [
      event(threadId, 1, "system/manager/user_message", { text: "one" }),
      event(threadId, 2, "thread/tokenUsage/updated", {
        tokenUsage: { total: { totalTokens: 10 } },
      }),
      commandCompleted(threadId, 3, "output"),
    ]);
    const excludedTypes: ThreadEventType[] = ["thread/tokenUsage/updated"];

    const rows = selectAppendedTimelineWindowRows(
      listAppendedEventRows(db, range(threadId, 32_000)),
      { excludeDiagnosticEvents: true, excludedTypes },
    );

    expect(rows).toEqual(
      listStoredTimelineWindowEventRows(db, {
        beforeSequence: 101,
        excludeDiagnosticEvents: true,
        excludedTypes,
        maxInlineOutputChars: 32_000,
        sequenceStart: 1,
        threadId,
      }),
    );
    expect(rows?.map((row) => row.sequence)).toEqual([1, 3]);
  });

  it("leaves rows the SQL filters decide to the window query", () => {
    const threadId = setup();
    insertEvents(db, noopNotifier, [
      event(threadId, 1, "provider/unhandled", { rawType: "x" }),
    ]);

    expect(
      selectAppendedTimelineWindowRows(
        listAppendedEventRows(db, range(threadId, 32_000)),
        { excludeDiagnosticEvents: true, excludedTypes: [] },
      ),
    ).toBeNull();
  });
});
