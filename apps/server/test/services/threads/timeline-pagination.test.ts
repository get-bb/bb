import { describe, expect, it } from "vitest";
import type {
  TimelineConversationRow,
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  THREAD_TIMELINE_PAGE_JSON_BYTE_TARGET,
  THREAD_TIMELINE_PAGE_ROW_LIMIT,
  isTimelineRowWindowCursor,
  paginateTimelineRows,
} from "../../../src/services/threads/timeline-pagination.js";

function userRow(args: {
  id: string;
  seq: number;
  text: string;
}): TimelineUserConversationRow {
  return {
    id: args.id,
    kind: "conversation",
    role: "user",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq,
    startedAt: args.seq,
    createdAt: args.seq,
    text: args.text,
    mentions: [],
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { kind: "message", status: "accepted" },
  };
}

function assistantRow(args: {
  id: string;
  seq: number;
  text?: string;
}): TimelineConversationRow {
  return {
    id: args.id,
    kind: "conversation",
    role: "assistant",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq,
    startedAt: args.seq,
    createdAt: args.seq,
    text: args.text ?? args.id,
    attachments: null,
    turnRequest: null,
  };
}

describe("paginateTimelineRows", () => {
  it("keeps grouped user rows from one request in the same segment", () => {
    const rows: TimelineRow[] = [
      userRow({
        id: "thread-1:user-seed:1",
        seq: 1,
        text: "older",
      }),
      userRow({
        id: "thread-1:user-seed:2",
        seq: 2,
        text: "group first",
      }),
      userRow({
        id: "thread-1:user-seed:2-1",
        seq: 2,
        text: "group second",
      }),
      userRow({
        id: "thread-1:user-seed:3",
        seq: 3,
        text: "newer",
      }),
    ];

    const page = paginateTimelineRows(
      rows,
      {
        kind: "latest",
        segmentLimit: 2,
      },
      { eventWindowOlderCursor: null },
    );

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:user-seed:2",
      "thread-1:user-seed:2-1",
      "thread-1:user-seed:3",
    ]);
    expect(page.olderCursor).toEqual({
      anchorId: "thread-1:user-seed:2",
      anchorSeq: 2,
    });
  });

  it("bounds one giant logical segment and pages through it without gaps", () => {
    const rows: TimelineRow[] = [
      userRow({ id: "user", seq: 1, text: "do all the work" }),
      ...Array.from({ length: THREAD_TIMELINE_PAGE_ROW_LIMIT + 40 }, (_, i) =>
        assistantRow({ id: `work-${i + 1}`, seq: i + 2 }),
      ),
    ];

    const latest = paginateTimelineRows(
      rows,
      {
        kind: "latest",
        segmentLimit: 20,
      },
      { eventWindowOlderCursor: null },
    );

    expect(latest.rows).toHaveLength(THREAD_TIMELINE_PAGE_ROW_LIMIT);
    expect(latest.hasOlderRows).toBe(true);
    expect(latest.returnedSegmentCount).toBe(1);
    expect(latest.olderCursor).not.toBeNull();
    expect(isTimelineRowWindowCursor(latest.olderCursor!)).toBe(true);

    const olderSourceRows = rows.filter(
      (row) => row.sourceSeqStart < latest.olderCursor!.anchorSeq,
    );
    const older = paginateTimelineRows(
      olderSourceRows,
      {
        kind: "older",
        segmentLimit: 20,
        beforeCursor: latest.olderCursor!,
      },
      { eventWindowOlderCursor: null },
    );

    expect(older.hasOlderRows).toBe(false);
    expect([
      ...older.rows.map((row) => row.id),
      ...latest.rows.map((row) => row.id),
    ]).toEqual(rows.map((row) => row.id));
  });

  it("uses serialized row bytes as a second bound for output-heavy turns", () => {
    const rows: TimelineRow[] = [
      userRow({ id: "user", seq: 1, text: "produce verbose output" }),
      ...Array.from({ length: 30 }, (_, i) =>
        assistantRow({
          id: `verbose-${i + 1}`,
          seq: i + 2,
          text: "x".repeat(50_000),
        }),
      ),
    ];

    const page = paginateTimelineRows(
      rows,
      {
        kind: "latest",
        segmentLimit: 20,
      },
      { eventWindowOlderCursor: null },
    );
    const pageBytes = Buffer.byteLength(JSON.stringify(page.rows), "utf8");

    expect(page.rows.length).toBeLessThan(THREAD_TIMELINE_PAGE_ROW_LIMIT);
    expect(pageBytes).toBeLessThanOrEqual(
      THREAD_TIMELINE_PAGE_JSON_BYTE_TARGET + 2,
    );
    expect(page.hasOlderRows).toBe(true);
    expect(
      page.olderCursor && isTimelineRowWindowCursor(page.olderCursor),
    ).toBe(true);
  });
});
