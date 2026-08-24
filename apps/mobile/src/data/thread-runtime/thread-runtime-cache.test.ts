import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
} from "@/lib/query/query-keys";
import {
  project,
  queuedMessage,
  sidebarBootstrap,
  threadListEntry,
  threadResponse,
  timelineResponse,
} from "../test/fixtures";
import {
  appendPendingStopRow,
  applyQueuedMessageCreateResult,
  applySendThreadMessageSuccess,
  applyThreadPlanCancellationResult,
  beginCreateQueuedMessageTransaction,
  beginReorderQueuedMessageTransaction,
  beginSendQueuedMessageTransaction,
  beginSendThreadMessageTransaction,
  beginStopThreadTransaction,
  beginUpdateQueuedMessageTransaction,
  buildOptimisticUserMessageRow,
  rollbackRemoveQueuedMessageTransaction,
  rollbackSendThreadMessageTransaction,
  rollbackStopThreadTransaction,
  rollbackUpdateQueuedMessageTransaction,
} from "./thread-runtime-cache";

function assistantRow(id: string, seq: number): TimelineRow {
  return {
    kind: "conversation",
    role: "assistant",
    id,
    threadId: "t1",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    text: `row ${id}`,
    attachments: null,
    turnRequest: null,
  };
}

function seed(status: "idle" | "active" = "idle") {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    threadQueryKey("t1"),
    threadResponse({
      id: "t1",
      status,
      runtime: { displayStatus: status, hostReconnectGraceExpiresAt: null },
    }),
  );
  queryClient.setQueryData(
    threadTimelineQueryKey("t1"),
    timelineResponse([assistantRow("r1", 1)]),
  );
  queryClient.setQueryData(threadQueuedMessagesQueryKey("t1"), []);
  const entry = threadListEntry({ id: "t1", status });
  queryClient.setQueryData(threadListQueryKey({ archived: false }), [entry]);
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    sidebarBootstrap({
      projects: [project({ id: "proj_1", threads: [entry] })],
    }),
  );
  return queryClient;
}

function timelineRows(queryClient: QueryClient): TimelineRow[] {
  return (
    queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("t1"),
    )?.rows ?? []
  );
}

const sendRequest = {
  id: "t1",
  input: [
    {
      type: "text" as const,
      text: "hello @file",
      mentions: [
        {
          start: 6,
          end: 11,
          resource: {
            kind: "path" as const,
            source: "workspace" as const,
            entryKind: "file" as const,
            path: "file",
            label: "file",
          },
        },
      ],
    },
  ],
  mode: "queue-if-active" as const,
};

describe("send thread message transaction", () => {
  it("inserts an optimistic user row and flips the thread active, then rolls back", async () => {
    const queryClient = seed("idle");
    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: sendRequest,
    });
    expect(transaction.kind).toBe("accepted-turn");
    const rows = timelineRows(queryClient);
    expect(rows).toHaveLength(2);
    const optimistic = rows[1];
    expect(optimistic?.id.startsWith("optimistic-user-")).toBe(true);
    expect(optimistic?.kind === "conversation" && optimistic.text).toBe(
      "hello @file",
    );
    expect(
      optimistic?.kind === "conversation" &&
        optimistic.role === "user" &&
        optimistic.mentions,
    ).toHaveLength(1);
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toMatchObject({
      status: "active",
      runtime: { displayStatus: "active" },
    });

    rollbackSendThreadMessageTransaction({
      queryClient,
      request: sendRequest,
      transaction,
    });
    expect(timelineRows(queryClient).map((row) => row.id)).toEqual(["r1"]);
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toMatchObject({
      status: "idle",
    });
  });

  it("queues optimistically when the thread is active, and restores on rollback", async () => {
    const queryClient = seed("active");
    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: sendRequest,
    });
    expect(transaction.kind).toBe("queued-message");
    expect(timelineRows(queryClient)).toHaveLength(1);
    const queued = queryClient.getQueryData<{ id: string }[]>(
      threadQueuedMessagesQueryKey("t1"),
    );
    expect(queued).toHaveLength(1);
    expect(queued?.[0]?.id.startsWith("optimistic-queued-")).toBe(true);
    rollbackSendThreadMessageTransaction({
      queryClient,
      request: sendRequest,
      transaction,
    });
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("t1")),
    ).toEqual([]);
  });

  it("steer-if-active still renders a row (marked steer) on an active thread", async () => {
    const queryClient = seed("active");
    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: { ...sendRequest, mode: "steer-if-active" },
    });
    expect(transaction.kind).toBe("accepted-turn");
    const row = timelineRows(queryClient)[1];
    expect(
      row?.kind === "conversation" && row.role === "user" && row.turnRequest,
    ).toMatchObject({ kind: "steer", status: "pending" });
  });

  it("preserves host blockers instead of promoting them to active", async () => {
    const queryClient = seed("idle");
    queryClient.setQueryData(
      threadQueryKey("t1"),
      threadResponse({
        id: "t1",
        status: "idle",
        runtime: {
          displayStatus: "host-reconnecting",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    );
    await beginSendThreadMessageTransaction({
      queryClient,
      request: sendRequest,
    });
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toMatchObject({
      status: "active",
      runtime: { displayStatus: "host-reconnecting" },
    });
  });

  it("invalidates the timeline only without realtime", async () => {
    const queryClient = seed("idle");
    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: sendRequest,
    });
    applySendThreadMessageSuccess({
      queryClient,
      realtimeConnected: true,
      request: sendRequest,
      transaction,
    });
    expect(
      queryClient.getQueryState(threadTimelineQueryKey("t1"))?.isInvalidated,
    ).toBe(false);
    applySendThreadMessageSuccess({
      queryClient,
      realtimeConnected: false,
      request: sendRequest,
      transaction,
    });
    expect(
      queryClient.getQueryState(threadTimelineQueryKey("t1"))?.isInvalidated,
    ).toBe(true);
  });

  it("builds attachment counts from the prompt input", () => {
    const row = buildOptimisticUserMessageRow({
      createdAt: 5,
      input: [
        { type: "text", text: "see", mentions: [] },
        { type: "localImage", path: "a.png" },
        { type: "localFile", path: "b.txt" },
        {
          type: "text",
          text: "hidden",
          mentions: [],
          visibility: "agent-only",
        },
      ],
      mode: "auto",
      threadId: "t1",
      threadStatus: "idle",
    });
    expect(row.kind === "conversation" && row.text).toBe("see");
    expect(row.kind === "conversation" && row.attachments).toEqual({
      webImages: 0,
      localImages: 1,
      localFiles: 1,
      imageUrls: [],
      localImagePaths: ["a.png"],
      localFilePaths: ["b.txt"],
    });
  });
});

describe("queued message transactions", () => {
  it("replaces the optimistic entry with the server's on create", async () => {
    const queryClient = seed("active");
    const request = { id: "t1", input: sendRequest.input };
    const transaction = await beginCreateQueuedMessageTransaction({
      queryClient,
      request,
    });
    const created = queuedMessage({ id: "qm_1" });
    applyQueuedMessageCreateResult({
      queryClient,
      queuedMessage: created,
      threadId: "t1",
      transaction,
    });
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("t1")),
    ).toEqual([created]);
    // A realtime refetch that already delivered it is not duplicated.
    applyQueuedMessageCreateResult({
      queryClient,
      queuedMessage: created,
      threadId: "t1",
      transaction,
    });
    expect(
      queryClient.getQueryData<unknown[]>(threadQueuedMessagesQueryKey("t1")),
    ).toHaveLength(1);
  });

  it("rolls an edit back only while the optimistic version is still cached", async () => {
    const queryClient = seed("active");
    const original = queuedMessage({ id: "qm_1", updatedAt: 10 });
    queryClient.setQueryData(threadQueuedMessagesQueryKey("t1"), [original]);
    const request = {
      id: "t1",
      queuedMessageId: "qm_1",
      expectedUpdatedAt: 10,
      input: [{ type: "text" as const, text: "edited", mentions: [] }],
    };
    const transaction = await beginUpdateQueuedMessageTransaction({
      queryClient,
      request,
    });
    const optimistic = queryClient.getQueryData<(typeof original)[]>(
      threadQueuedMessagesQueryKey("t1"),
    )?.[0];
    expect(optimistic?.content[0]).toMatchObject({ text: "edited" });
    expect(optimistic?.updatedAt).toBeGreaterThan(10);
    rollbackUpdateQueuedMessageTransaction({
      queryClient,
      request,
      transaction,
    });
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("t1")),
    ).toEqual([original]);
  });

  it("send-now removes the lead group and renders a row only for a single message", async () => {
    const queryClient = seed("idle");
    queryClient.setQueryData(threadQueuedMessagesQueryKey("t1"), [
      queuedMessage({ id: "a", groupWithNext: true }),
      queuedMessage({ id: "b" }),
      queuedMessage({ id: "c" }),
    ]);
    const groupTransaction = await beginSendQueuedMessageTransaction({
      queryClient,
      request: { id: "t1", queuedMessageId: "a", mode: "auto" },
    });
    expect(groupTransaction.optimisticRowId).toBeNull();
    expect(
      queryClient
        .getQueryData<{ id: string }[]>(threadQueuedMessagesQueryKey("t1"))
        ?.map((m) => m.id),
    ).toEqual(["c"]);
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toMatchObject({
      status: "active",
    });
    rollbackRemoveQueuedMessageTransaction({
      queryClient,
      threadId: "t1",
      transaction: groupTransaction,
    });
    expect(
      queryClient
        .getQueryData<{ id: string }[]>(threadQueuedMessagesQueryKey("t1"))
        ?.map((m) => m.id),
    ).toEqual(["a", "b", "c"]);
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toMatchObject({
      status: "idle",
    });

    const singleTransaction = await beginSendQueuedMessageTransaction({
      queryClient,
      request: { id: "t1", queuedMessageId: "c", mode: "auto" },
    });
    expect(singleTransaction.optimisticRowId).not.toBeNull();
    expect(timelineRows(queryClient)).toHaveLength(2);
    rollbackRemoveQueuedMessageTransaction({
      queryClient,
      threadId: "t1",
      transaction: singleTransaction,
    });
    expect(timelineRows(queryClient)).toHaveLength(1);
  });

  it("applies a reorder synchronously and keeps the lead group when intact", async () => {
    const queryClient = seed("active");
    queryClient.setQueryData(threadQueuedMessagesQueryKey("t1"), [
      queuedMessage({ id: "a", groupWithNext: true }),
      queuedMessage({ id: "b" }),
      queuedMessage({ id: "c" }),
    ]);
    const pending = beginReorderQueuedMessageTransaction({
      queryClient,
      request: {
        id: "t1",
        queuedMessageId: "b",
        previousQueuedMessageId: null,
        nextQueuedMessageId: "a",
      },
    });
    expect(
      queryClient
        .getQueryData<
          { id: string; groupWithNext: boolean }[]
        >(threadQueuedMessagesQueryKey("t1"))
        ?.map((m) => [m.id, m.groupWithNext]),
    ).toEqual([
      ["b", true],
      ["a", false],
      ["c", false],
    ]);
    await pending;
  });
});

describe("stop thread transaction", () => {
  it("marks the thread stopping everywhere and restores on rollback", async () => {
    const queryClient = seed("active");
    const transaction = await beginStopThreadTransaction({
      queryClient,
      requestedAt: 50,
      threadId: "t1",
    });
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toMatchObject({
      status: "stopping",
      runtime: { displayStatus: "stopping" },
    });
    expect(
      queryClient.getQueryData<{ status: string }[]>(
        threadListQueryKey({ archived: false }),
      )?.[0]?.status,
    ).toBe("stopping");
    rollbackStopThreadTransaction({ queryClient, threadId: "t1", transaction });
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toMatchObject({
      status: "active",
    });
    expect(
      queryClient.getQueryData<{ status: string }[]>(
        threadListQueryKey({ archived: false }),
      )?.[0]?.status,
    ).toBe("active");
  });

  it("appends a Stop requested row until the server's interrupted row exists", () => {
    const rows = [assistantRow("r1", 1)];
    const withStop = appendPendingStopRow(rows, {
      isStopping: true,
      stoppingAnchorAt: 9,
      threadId: "t1",
    });
    expect(withStop).toHaveLength(2);
    expect(withStop[1]).toMatchObject({
      kind: "system",
      operationKind: "thread-interrupted",
      title: "Stop requested",
    });
    expect(
      appendPendingStopRow(withStop, {
        isStopping: true,
        stoppingAnchorAt: 9,
        threadId: "t1",
      }),
    ).toBe(withStop);
    expect(
      appendPendingStopRow(rows, {
        isStopping: false,
        stoppingAnchorAt: 9,
        threadId: "t1",
      }),
    ).toBe(rows);
  });
});

describe("banner cancellation", () => {
  it("clears the active plan mode and the list counter", () => {
    const queryClient = seed("active");
    queryClient.setQueryData(
      threadTimelineQueryKey("t1"),
      timelineResponse([], {
        activePromptMode: { mode: "plan", providerId: "fake", prompt: "x" },
      }),
    );
    const entry = threadListEntry({
      id: "t1",
      activity: {
        activeWorkflowCount: 0,
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 0,
        activePlanModeCount: 1,
        activeGoalCount: 0,
      },
    });
    queryClient.setQueryData(threadListQueryKey({ archived: false }), [entry]);
    applyThreadPlanCancellationResult(queryClient, "t1");
    expect(
      queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("t1"),
      )?.activePromptMode,
    ).toBeNull();
    expect(
      queryClient.getQueryData<{ activity: { activePlanModeCount: number } }[]>(
        threadListQueryKey({ archived: false }),
      )?.[0]?.activity.activePlanModeCount,
    ).toBe(0);
  });
});
