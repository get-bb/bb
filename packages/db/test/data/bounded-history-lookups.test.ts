import { describe, expect, it } from "vitest";
import { threadScope, turnScope, type ThreadEventType } from "@bb/domain";
import { noopNotifier } from "../../src/notifier.js";
import {
  getLastStoredTurnRequestEvent,
  getStoredConversationOutlineProjectionState,
  hasStoredProviderTurnCompletedSince,
  insertEvents,
  isStoredTurnContextCompactionOnly,
  isStoredTurnProviderCompactionRunning,
  listLatestTurnFinalAgentMessageEventRows,
  listStoredTaskTurnRequestEvents,
  listStoredTimelineThreadWindowEventRows,
  listStoredTurnCompletedRowsByTurnIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  type InsertEventInput,
} from "../../src/data/events.js";
import { createEnvironment } from "../../src/data/environments.js";
import { createProject } from "../../src/data/projects.js";
import {
  createThread,
  isThreadAwaitingTurnStartPastDeadline,
  listTurnStartDeadlineCandidates,
} from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    path: "/tmp/test",
    providerOwnsPath: false,
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "codex",
    status: "active",
  });
  return { db, thread };
}

interface EventArgs {
  createdAt?: number;
  data?: object;
  itemId?: string;
  itemKind?: InsertEventInput["itemKind"];
  parentToolCallId?: string;
  providerThreadId?: string;
  turnId?: string;
}

function event(
  threadId: string,
  sequence: number,
  type: ThreadEventType,
  args: EventArgs = {},
): InsertEventInput {
  return {
    threadId,
    sequence,
    type,
    scope: args.turnId === undefined ? threadScope() : turnScope(args.turnId),
    itemId: args.itemId ?? null,
    itemKind: args.itemKind ?? null,
    parentToolCallId: args.parentToolCallId ?? null,
    providerThreadId: args.providerThreadId ?? null,
    ...(args.createdAt === undefined ? {} : { createdAt: args.createdAt }),
    data: JSON.stringify(args.data ?? {}),
  };
}

function request(
  requestId: string,
  overrides: Record<string, unknown> = {},
): object {
  return {
    direction: "outbound",
    requestId,
    source: "tell",
    initiator: "user",
    input: [{ type: "text", text: requestId, mentions: [] }],
    target: { kind: "new-turn" },
    request: { method: "turn/start", params: {} },
    ...overrides,
  };
}

describe("history lookups bounded by existing indexes", () => {
  it("lists turn started and completed rows only for the requested turns", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "turn/started", { turnId: "turn-a" }),
      event(thread.id, 2, "turn/completed", { turnId: "turn-a" }),
      event(thread.id, 3, "turn/started", { turnId: "turn-b" }),
      event(thread.id, 4, "turn/completed", { turnId: "turn-b" }),
      event(thread.id, 5, "turn/started", { turnId: "turn-c" }),
    ]);

    expect(
      listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        sequenceCutoff: 4,
        threadId: thread.id,
        turnIds: ["turn-a", "turn-c"],
      }).map((row) => row.sequence),
    ).toEqual([1]);
    expect(
      listStoredTurnCompletedRowsByTurnIds(db, {
        threadId: thread.id,
        turnIds: ["turn-b", "turn-a"],
      }).map((row) => row.sequence),
    ).toEqual([2, 4]);
  });

  it("finds a provider's turn completion only at or after the given time", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "turn/completed", {
        createdAt: 1_000,
        providerThreadId: "provider-1",
        turnId: "turn-1",
      }),
      event(thread.id, 2, "turn/completed", {
        createdAt: 2_000,
        providerThreadId: "provider-2",
        turnId: "turn-2",
      }),
      event(thread.id, 3, "turn/completed", {
        createdAt: 3_000,
        providerThreadId: "provider-1",
        turnId: "turn-3",
      }),
    ]);
    const completedSince = (createdAt: number, providerThreadId: string) =>
      hasStoredProviderTurnCompletedSince(db, {
        createdAt,
        providerThreadId,
        threadId: thread.id,
      });

    expect(completedSince(1_500, "provider-2")).toBe(true);
    expect(completedSince(2_000, "provider-2")).toBe(true);
    expect(completedSince(2_500, "provider-2")).toBe(false);
    expect(completedSince(2_500, "provider-1")).toBe(true);
    expect(completedSince(3_500, "provider-1")).toBe(false);
  });

  it("treats an active thread as awaiting its turn start until a turn completes after the deadline", () => {
    const { db, thread } = setup();
    const deadline = Date.now() + 60_000;
    const awaiting = () => ({
      candidate: listTurnStartDeadlineCandidates(db, { deadline }).some(
        (candidate) => candidate.threadId === thread.id,
      ),
      thread: isThreadAwaitingTurnStartPastDeadline(db, {
        deadline,
        threadId: thread.id,
      }),
    });

    expect(awaiting()).toEqual({ candidate: true, thread: true });
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "turn/completed", {
        createdAt: deadline - 10_000,
        turnId: "turn-1",
      }),
    ]);
    expect(awaiting()).toEqual({ candidate: true, thread: true });
    insertEvents(db, noopNotifier, [
      event(thread.id, 2, "turn/completed", {
        createdAt: deadline + 1,
        turnId: "turn-2",
      }),
    ]);
    expect(awaiting()).toEqual({ candidate: false, thread: false });
  });

  it("returns the newest turn request across current and legacy request types", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "client/thread/start", {
        data: { input: [] },
      }),
      event(thread.id, 2, "client/turn/requested", {
        data: request("creq_23456789aa"),
      }),
      event(thread.id, 3, "client/turn/start", { data: {} }),
      event(thread.id, 4, "turn/started", { turnId: "turn-1" }),
    ]);
    expect(getLastStoredTurnRequestEvent(db, thread.id)?.sequence).toBe(2);

    insertEvents(db, noopNotifier, [
      event(thread.id, 5, "client/turn/start", { data: { input: [] } }),
    ]);
    expect(getLastStoredTurnRequestEvent(db, thread.id)?.sequence).toBe(5);
  });

  it("lists the user's task requests in order across request types", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "client/turn/requested", {
        data: request("creq_23456789aa"),
      }),
      event(thread.id, 2, "client/turn/requested", {
        data: request("creq_23456789ab", { initiator: "agent" }),
      }),
      event(thread.id, 3, "client/turn/requested", {
        data: request("creq_23456789ac", { systemMessageKind: "notice" }),
      }),
      event(thread.id, 4, "client/thread/start", { data: { input: [] } }),
      event(thread.id, 5, "client/turn/requested", {
        data: request("creq_23456789ad"),
      }),
    ]);
    const sequences = (order: "oldest" | "newest") =>
      listStoredTaskTurnRequestEvents(db, {
        limit: 2,
        order,
        threadId: thread.id,
      }).map((row) => row.sequence);

    expect(sequences("newest")).toEqual([5, 4]);
    expect(sequences("oldest")).toEqual([1, 4]);
  });

  it("includes nested events only for a nested turn whose root request started a turn", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "client/turn/requested", {
        data: request("creq_23456789aa"),
      }),
      event(thread.id, 2, "turn/started", { turnId: "turn-root" }),
      event(thread.id, 3, "turn/input/accepted", {
        data: { clientRequestId: "creq_23456789aa" },
        turnId: "turn-root",
      }),
      event(thread.id, 4, "turn/started", {
        parentToolCallId: "call-1",
        turnId: "turn-root",
      }),
      event(thread.id, 5, "client/turn/requested", {
        data: request("creq_23456789ab", {
          target: { kind: "steer", expectedTurnId: "turn-steered" },
        }),
      }),
      event(thread.id, 6, "turn/started", { turnId: "turn-steered" }),
      event(thread.id, 7, "turn/input/accepted", {
        data: { clientRequestId: "creq_23456789ab" },
        turnId: "turn-steered",
      }),
      event(thread.id, 8, "turn/started", {
        parentToolCallId: "call-2",
        turnId: "turn-steered",
      }),
    ]);
    const includeNestedEvents = (classificationSequenceStart: number) =>
      getStoredConversationOutlineProjectionState(db, {
        classificationSequenceStart,
        sequenceStart: 0,
        summaryCompactionDeltaThreshold: 1_000,
        threadId: thread.id,
      }).includeNestedEvents;

    expect(includeNestedEvents(0)).toBe(true);
    expect(includeNestedEvents(4)).toBe(true);
    expect(includeNestedEvents(5)).toBe(false);
  });

  it("lists only thread-scoped rows inside the timeline window", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "client/turn/requested", {
        data: request("creq_23456789aa"),
      }),
      event(thread.id, 2, "turn/started", { turnId: "turn-1" }),
      event(thread.id, 3, "client/turn/requested", {
        data: request("creq_23456789ab"),
      }),
      event(thread.id, 4, "turn/completed", { turnId: "turn-1" }),
      event(thread.id, 5, "client/turn/requested", {
        data: request("creq_23456789ac"),
      }),
    ]);

    expect(
      listStoredTimelineThreadWindowEventRows(db, {
        beforeSequence: 5,
        maxInlineOutputChars: null,
        sequenceStart: 2,
        threadId: thread.id,
      }).map((row) => row.sequence),
    ).toEqual([3]);
  });
  it("reports a provider compaction running only while the turn's latest root compaction has started", () => {
    const { db, thread } = setup();
    const running = (turnId: string) =>
      isStoredTurnProviderCompactionRunning(db, { threadId: thread.id, turnId });
    const compaction = (
      sequence: number,
      type: "item/started" | "item/completed",
      turnId: string,
      itemId: string,
      parentToolCallId?: string,
    ) =>
      event(thread.id, sequence, type, {
        itemId,
        itemKind: "contextCompaction",
        turnId,
        ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
      });

    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "turn/started", { turnId: "turn-1" }),
      compaction(2, "item/started", "turn-1", "compact-1"),
    ]);
    expect(running("turn-1")).toBe(true);
    expect(running("turn-2")).toBe(false);

    insertEvents(db, noopNotifier, [
      compaction(3, "item/completed", "turn-1", "compact-1"),
      compaction(4, "item/started", "turn-1", "nested", "call-1"),
    ]);
    expect(running("turn-1")).toBe(false);

    insertEvents(db, noopNotifier, [
      compaction(5, "item/started", "turn-1", "compact-2"),
    ]);
    expect(running("turn-1")).toBe(true);

    insertEvents(db, noopNotifier, [
      event(thread.id, 6, "turn/input/accepted", {
        data: { clientRequestId: "creq_23456789aa" },
        turnId: "turn-1",
      }),
    ]);
    expect(running("turn-1")).toBe(false);
  });

  it("treats a turn as compaction-only when its only root completed items are compactions", () => {
    const { db, thread } = setup();
    const compactionOnly = (turnId: string) =>
      isStoredTurnContextCompactionOnly(db, { threadId: thread.id, turnId });
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "turn/started", { turnId: "turn-1" }),
      event(thread.id, 2, "item/completed", {
        itemId: "compact-1",
        itemKind: "contextCompaction",
        turnId: "turn-1",
      }),
      event(thread.id, 3, "item/completed", {
        itemId: "nested-message",
        itemKind: "agentMessage",
        parentToolCallId: "call-1",
        turnId: "turn-1",
      }),
      event(thread.id, 4, "turn/started", { turnId: "turn-2" }),
    ]);
    expect(compactionOnly("turn-1")).toBe(true);
    expect(compactionOnly("turn-2")).toBe(false);

    insertEvents(db, noopNotifier, [
      event(thread.id, 5, "item/completed", {
        itemId: "message-1",
        itemKind: "agentMessage",
        turnId: "turn-1",
      }),
    ]);
    expect(compactionOnly("turn-1")).toBe(false);
  });

  it("lists each turn's final root agent reply, newest first, skipping turns whose final reply is empty", () => {
    const { db, thread } = setup();
    const reply = (
      sequence: number,
      turnId: string,
      text: string,
      parentToolCallId?: string,
    ) =>
      event(thread.id, sequence, "item/completed", {
        data: { item: { type: "agentMessage", id: `m${sequence}`, text } },
        itemId: `m${sequence}`,
        itemKind: "agentMessage",
        turnId,
        ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
      });
    insertEvents(db, noopNotifier, [
      event(thread.id, 1, "turn/started", { turnId: "turn-1" }),
      reply(2, "turn-1", "first draft"),
      reply(3, "turn-1", "first final"),
      event(thread.id, 4, "turn/started", { turnId: "turn-2" }),
      reply(5, "turn-2", "second draft"),
      reply(6, "turn-2", ""),
      event(thread.id, 7, "turn/started", { turnId: "turn-3" }),
      reply(8, "turn-3", "third draft"),
      reply(9, "turn-3", "third final"),
      reply(10, "turn-3", "nested reply", "call-1"),
    ]);
    const sequences = (limit: number) =>
      listLatestTurnFinalAgentMessageEventRows(db, {
        limit,
        threadId: thread.id,
      }).map((row) => row.sequence);

    expect(sequences(1)).toEqual([9]);
    expect(sequences(2)).toEqual([9, 3]);
    expect(sequences(5)).toEqual([9, 3]);
  });
});
