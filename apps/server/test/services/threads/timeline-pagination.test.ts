import { describe, expect, it } from "vitest";
import type {
  TimelineRow,
  TimelineTurnRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { paginateTimelineRows } from "../../../src/services/threads/timeline-pagination.js";

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
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
}

function steerRow(args: {
  id: string;
  seq: number;
  text: string;
}): TimelineUserConversationRow {
  return {
    ...userRow(args),
    turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
  };
}

function assistantRow(seq: number): TimelineRow {
  return {
    id: `thread-1:assistant:${seq}`,
    kind: "conversation",
    role: "assistant",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    text: `assistant ${seq}`,
    attachments: null,
    turnRequest: null,
  };
}

describe("paginateTimelineRows", () => {
  it("returns each row identity once when projection repeats a row", () => {
    const user = userRow({ id: "user", seq: 1, text: "Request" });
    const assistant = assistantRow(2);
    const page = paginateTimelineRows({
      knownHasOlderSegments: false,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 0,
      ownedSequenceEnd: 3,
      page: { kind: "latest", segmentLimit: 20 },
      rows: [user, assistant, { ...assistant }],
    });
    expect(page.rows).toEqual([user, assistant]);
    expect(page.olderCursor).toBeNull();
    expect(page.hasOlderRows).toBe(false);
  });

  it("keeps grouped user rows from one request in the same segment", () => {
    const rows: TimelineRow[] = [
      userRow({ id: "thread-1:user-seed:1", seq: 1, text: "older" }),
      userRow({ id: "thread-1:user-seed:2", seq: 2, text: "group first" }),
      userRow({ id: "thread-1:user-seed:2-1", seq: 2, text: "group second" }),
      userRow({ id: "thread-1:user-seed:3", seq: 3, text: "newer" }),
    ];

    const page = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 0,
      ownedSequenceEnd: 4,
      page: { kind: "latest", segmentLimit: 2 },
      rows,
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:user-seed:2",
      "thread-1:user-seed:2-1",
      "thread-1:user-seed:3",
    ]);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:2",
      anchorSeq: 2,
    });
  });

  it("keeps rows recorded after a request that display before it in the request's segment", () => {
    const providerEnvironment: TimelineRow = {
      id: "thread-1:op:provider-environment:15",
      kind: "system",
      threadId: "thread-1",
      turnId: null,
      sourceSeqStart: 15,
      sourceSeqEnd: 15,
      startedAt: 15,
      createdAt: 15,
      systemKind: "operation",
      operationKind: "generic",
      title: "Provider environment resolved",
      detail: null,
      status: "completed",
      completedAt: 15,
    };
    const rows: TimelineRow[] = [
      providerEnvironment,
      userRow({ id: "thread-1:user-seed:13", seq: 13, text: "follow-up" }),
      userRow({ id: "thread-1:user-seed:20", seq: 20, text: "newer" }),
    ];

    const page = paginateTimelineRows({
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 13,
      ownedSequenceEnd: 21,
      page: { kind: "latest", segmentLimit: 20 },
      rows,
    });

    expect(page.rows.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(page.olderRowsSourceSeqEnd).toBeNull();
    expect(page.returnedSegmentCount).toBe(2);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:13",
      anchorSeq: 13,
    });
  });

  it("sends context-only older groups changed inside the latest window as updates", () => {
    const olderUser = userRow({
      id: "thread-1:user-seed:1",
      seq: 1,
      text: "older",
    });
    const lateOlderRow: TimelineRow = {
      ...userRow({ id: "thread-1:late-older-row", seq: 2, text: "late" }),
      sourceSeqEnd: 31,
      turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
    };
    const latestUser = userRow({
      id: "thread-1:user-seed:20",
      seq: 20,
      text: "latest",
    });

    const page = paginateTimelineRows({
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 20,
      ownedSequenceEnd: 32,
      page: { kind: "latest", segmentLimit: 20 },
      rows: [olderUser, lateOlderRow, latestUser],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:user-seed:20"]);
    expect(page.olderRowsSourceSeqEnd).toBe(1);
    expect(page.olderRowUpdates).toEqual([lateOlderRow]);
  });

  it("sends omitted rows cut to the children changed inside the latest window", () => {
    const child = (seq: number, sourceSeqEnd = seq): TimelineRow => ({
      ...assistantRow(seq),
      sourceSeqEnd,
    });
    const nested: TimelineTurnRow = {
      id: "thread-1:turn:nested",
      kind: "turn",
      threadId: "thread-1",
      turnId: "turn-1",
      sourceSeqStart: 5,
      sourceSeqEnd: 5,
      startedAt: 5,
      createdAt: 5,
      status: "completed",
      summaryCount: 1,
      completedAt: 5,
      children: [child(5)],
    };
    const changedChild = child(4, 25);
    const newChild = userRow({
      id: "thread-1:new-child",
      seq: 26,
      text: "new",
    });
    const running: TimelineTurnRow = {
      ...nested,
      id: "thread-1:turn:running",
      sourceSeqStart: 2,
      sourceSeqEnd: 26,
      status: "pending",
      completedAt: null,
      children: [child(3), changedChild, nested, newChild],
    };
    const settled: TimelineRow = {
      ...userRow({ id: "thread-1:settled", seq: 6, text: "settled" }),
      sourceSeqEnd: 10,
      turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
    };

    const page = paginateTimelineRows({
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 20,
      ownedSequenceEnd: 27,
      page: { kind: "latest", segmentLimit: 20 },
      rows: [
        userRow({ id: "thread-1:user-seed:1", seq: 1, text: "older" }),
        running,
        settled,
        userRow({ id: "thread-1:user-seed:20", seq: 20, text: "latest" }),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:user-seed:20"]);
    expect(page.olderRowsSourceSeqEnd).toBe(10);
    expect(page.olderRowUpdates).toEqual([
      {
        ...running,
        children: [changedChild, { ...nested, children: [] }, newChild],
      },
    ]);
  });

  it("reports rows a content cut omitted from the oldest returned group", () => {
    const output = (
      id: string,
      seq: number,
      sourceSeqEnd: number,
    ): TimelineRow => ({
      ...assistantRow(seq),
      id,
      sourceSeqEnd,
    });

    const page = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 2,
      maxBytes: 1_000_000,
      ownedSequenceStart: 1,
      ownedSequenceEnd: 31,
      page: { kind: "latest", segmentLimit: 20 },
      rows: [
        userRow({ id: "thread-1:user-seed:1", seq: 1, text: "prompt" }),
        output("thread-1:running-item", 2, 30),
        output("thread-1:item-3", 3, 3),
        output("thread-1:item-4", 4, 4),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:item-3",
      "thread-1:item-4",
    ]);
    expect(page.contentPage).toMatchObject({
      anchorSeq: 1,
      start: 2,
      total: 4,
    });
    expect(page.olderRowsSourceSeqEnd).toBe(30);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:1",
      anchorSeq: 1,
    });
    expect(page.contentCursor).toEqual({ beforeLeaf: 2, beforeSequence: 31 });
  });

  it("continues a content cut at the next window bound, not a projected row", () => {
    const page = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 1,
      maxBytes: 1_000_000,
      ownedSequenceStart: 10,
      ownedSequenceEnd: 40,
      page: { kind: "latest", segmentLimit: 20 },
      rows: [
        assistantRow(12),
        assistantRow(14),
        assistantRow(33),
        assistantRow(35),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:assistant:35"]);
    expect(page.contentCursor).toEqual({ beforeLeaf: 3, beforeSequence: 40 });
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:10",
      anchorSeq: 10,
    });
    expect(page.olderRowsSourceSeqEnd).toBe(33);
  });

  it("reports owned groups a budget cut left out of the page", () => {
    const page = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 1,
      maxBytes: 300,
      ownedSequenceStart: 1,
      ownedSequenceEnd: 21,
      page: { kind: "latest", segmentLimit: 20 },
      rows: [
        {
          ...userRow({ id: "thread-1:user-seed:1", seq: 1, text: "older" }),
          sourceSeqEnd: 25,
        },
        userRow({ id: "thread-1:user-seed:20", seq: 20, text: "latest" }),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:user-seed:20"]);
    expect(page.olderRowsSourceSeqEnd).toBe(25);
    expect(page.olderRowUpdates).toBeUndefined();
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:20",
      anchorSeq: 20,
    });
  });

  it("keeps rows recorded before the first message as their own group", () => {
    const provisioning: TimelineRow = {
      id: "thread-1:op:thread-provisioning:1",
      kind: "system",
      threadId: "thread-1",
      turnId: null,
      sourceSeqStart: 1,
      sourceSeqEnd: 1,
      startedAt: 1,
      createdAt: 1,
      systemKind: "operation",
      operationKind: "generic",
      title: "Provisioned thread",
      detail: null,
      status: "completed",
      completedAt: 1,
    };

    const page = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 0,
      ownedSequenceEnd: 4,
      page: { kind: "latest", segmentLimit: 1 },
      rows: [
        provisioning,
        userRow({ id: "thread-1:user-seed:3", seq: 3, text: "first" }),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:user-seed:3"]);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:3",
      anchorSeq: 3,
    });

    const older = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 0,
      ownedSequenceEnd: 3,
      page: { kind: "older", beforeCursor: page.olderCursor!, segmentLimit: 1 },
      rows: [
        provisioning,
        userRow({ id: "thread-1:user-seed:3", seq: 3, text: "first" }),
      ],
    });
    expect(older.rows.map((row) => row.id)).toEqual([
      "thread-1:op:thread-provisioning:1",
    ]);
    expect(older.hasOlderRows).toBe(false);
    expect(older.olderCursor).toBeNull();
  });

  it("owns rows by the selected window, whatever row shape they project to", () => {
    const page = paginateTimelineRows({
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 15,
      ownedSequenceEnd: 30,
      page: { kind: "latest", segmentLimit: 8 },
      rows: [
        assistantRow(10),
        steerRow({ id: "thread-1:user-seed:20", seq: 20, text: "steer" }),
        assistantRow(21),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:user-seed:20",
      "thread-1:assistant:21",
    ]);
    expect(page.returnedSegmentCount).toBe(1);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:15",
      anchorSeq: 15,
    });
    expect(page.olderRowsSourceSeqEnd).toBe(10);
  });

  it("keeps an in-window row that displays before an accepted steer projected at its acceptance", () => {
    const notice = assistantRow(13093);
    const page = paginateTimelineRows({
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 12545,
      ownedSequenceEnd: 14416,
      page: { kind: "latest", segmentLimit: 20 },
      rows: [
        userRow({ id: "thread-1:user-seed:5198", seq: 5198, text: "context" }),
        steerRow({
          id: "thread-1:user-seed:12545",
          seq: 12547,
          text: "accepted steer",
        }),
        notice,
        userRow({
          id: "thread-1:user-seed:13091",
          seq: 13091,
          text: "new turn",
        }),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:user-seed:12545",
      "thread-1:assistant:13093",
      "thread-1:user-seed:13091",
    ]);
    expect(page.returnedSegmentCount).toBe(2);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:12545",
      anchorSeq: 12545,
    });
  });

  it("selects the newest groups when the window holds more than the limit", () => {
    const page = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 1,
      ownedSequenceEnd: 30,
      page: { kind: "latest", segmentLimit: 1 },
      rows: [
        userRow({ id: "thread-1:user-seed:1", seq: 1, text: "first" }),
        userRow({ id: "thread-1:user-seed:20", seq: 20, text: "second" }),
        assistantRow(21),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:user-seed:20",
      "thread-1:assistant:21",
    ]);
    expect(page.hasOlderRows).toBe(true);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:20",
      anchorSeq: 20,
    });
  });

  it("hands back the window start when the window projects no owned rows", () => {
    const page = paginateTimelineRows({
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 100,
      ownedSequenceEnd: 200,
      page: { kind: "latest", segmentLimit: 8 },
      rows: [userRow({ id: "thread-1:user-seed:5", seq: 5, text: "old" })],
    });

    expect(page.rows).toEqual([]);
    expect(page.hasOlderRows).toBe(true);
    expect(page.olderCursor).toEqual({
      anchorId: "timeline-window:100",
      anchorSeq: 100,
    });
    expect(page.olderRowsSourceSeqEnd).toBe(5);

    const last = paginateTimelineRows({
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 0,
      ownedSequenceEnd: 100,
      page: { kind: "older", beforeCursor: page.olderCursor!, segmentLimit: 8 },
      rows: [],
    });
    expect(last.hasOlderRows).toBe(false);
    expect(last.olderCursor).toBeNull();
  });
});
