import type { ThreadQueuedMessage } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
} from "../queries/query-keys";
import { threadDefaultExecutionOptionsQueryKey } from "../queries/thread-default-execution-options-query";
import {
  applyQueuedMessageCreateResult,
  beginCreateQueuedMessageTransaction,
  beginRemoveQueuedMessageTransaction,
  beginSendQueuedMessageTransaction,
  beginSendThreadMessageTransaction,
  rollbackCreateQueuedMessageTransaction,
  rollbackRemoveQueuedMessageTransaction,
  rollbackSendThreadMessageTransaction,
} from "./thread-runtime-cache-owner";

function makeTimelineResponse(): ThreadTimelineResponse {
  return {
    rows: [],
    activeThinking: null,
    activeWorkflow: null,
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

function makeQueuedMessage(
  message: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  return {
    id: "qmsg-1",
    content: [{ type: "text", text: "Queued message", mentions: [] }],
    model: "codex-test",
    reasoningLevel: "medium",
    permissionMode: "readonly",
    serviceTier: "default",
    createdAt: 1,
    updatedAt: 1,
    ...message,
  };
}

describe("thread runtime cache owner", () => {
  it("omits agent-only text from optimistic user messages", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );

    await beginSendThreadMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        mode: "auto",
        input: [
          {
            type: "text",
            text: "Hidden source context",
            mentions: [],
            visibility: "agent-only",
          },
          {
            type: "text",
            text: "Visible question",
            mentions: [],
          },
        ],
      },
    });

    const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
    expect(timeline?.rows).toHaveLength(1);
    expect(timeline?.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "Visible question",
    });
  });

  it("optimistically appends queued messages and replaces them with the server row", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      makeQueuedMessage({ id: "qmsg-existing" }),
    ]);
    queryClient.setQueryData(
      threadDefaultExecutionOptionsQueryKey("thread-1"),
      {
        model: "codex-default",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      },
    );
    queryClient.setQueryData(threadPromptHistoryQueryKey("thread-1"), []);

    const transaction = await beginCreateQueuedMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        input: [{ type: "text", text: "Queue this", mentions: [] }],
      },
    });

    const optimisticQueue = queryClient.getQueryData<ThreadQueuedMessage[]>(
      threadQueuedMessagesQueryKey("thread-1"),
    );
    expect(optimisticQueue).toHaveLength(2);
    expect(optimisticQueue?.[1]).toMatchObject({
      id: expect.stringMatching(/^optimistic-queued-/u),
      content: [{ type: "text", text: "Queue this", mentions: [] }],
      model: "codex-default",
      reasoningLevel: "high",
      permissionMode: "workspace-write",
      serviceTier: "fast",
    });

    const serverQueuedMessage = makeQueuedMessage({
      id: "qmsg-server",
      content: [{ type: "text", text: "Queue this", mentions: [] }],
      createdAt: 10,
      updatedAt: 10,
    });
    applyQueuedMessageCreateResult({
      queryClient,
      queuedMessage: serverQueuedMessage,
      threadId: "thread-1",
      transaction,
    });

    expect(
      queryClient
        .getQueryData<
          ThreadQueuedMessage[]
        >(threadQueuedMessagesQueryKey("thread-1"))
        ?.map((queuedMessage) => queuedMessage.id),
    ).toEqual(["qmsg-existing", "qmsg-server"]);
    expect(
      queryClient.getQueryData(threadPromptHistoryQueryKey("thread-1")),
    ).toEqual([
      {
        id: "queued-message:qmsg-server",
        createdAt: 10,
        input: [{ type: "text", text: "Queue this", mentions: [] }],
      },
    ]);
  });

  it("rolls back optimistic queued message creation", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    const previousQueue = [makeQueuedMessage({ id: "qmsg-existing" })];
    queryClient.setQueryData(
      threadQueuedMessagesQueryKey("thread-1"),
      previousQueue,
    );

    const transaction = await beginCreateQueuedMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        input: [{ type: "text", text: "Queue this", mentions: [] }],
      },
    });
    rollbackCreateQueuedMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        input: [{ type: "text", text: "Queue this", mentions: [] }],
      },
      transaction,
    });

    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual(previousQueue);
  });

  it("optimistically queues queue-if-active sends", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    queryClient.setQueryData(threadQueryKey("thread-1"), {
      status: "active",
    });
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), []);

    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        mode: "queue-if-active",
        input: [{ type: "text", text: "Queue through send", mentions: [] }],
      },
    });

    expect(transaction.kind).toBe("queued-message");
    expect(
      queryClient.getQueryData<ThreadQueuedMessage[]>(
        threadQueuedMessagesQueryKey("thread-1"),
      ),
    ).toMatchObject([
      {
        id: expect.stringMatching(/^optimistic-queued-/u),
        content: [{ type: "text", text: "Queue through send", mentions: [] }],
      },
    ]);

    rollbackSendThreadMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        mode: "queue-if-active",
        input: [{ type: "text", text: "Queue through send", mentions: [] }],
      },
      transaction,
    });
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual([]);
  });

  it("optimistically removes queued messages and rolls back on failure", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    const previousQueue = [
      makeQueuedMessage({ id: "qmsg-1" }),
      makeQueuedMessage({ id: "qmsg-2" }),
    ];
    queryClient.setQueryData(
      threadQueuedMessagesQueryKey("thread-1"),
      previousQueue,
    );

    const transaction = await beginRemoveQueuedMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        queuedMessageId: "qmsg-1",
      },
    });

    expect(
      queryClient
        .getQueryData<
          ThreadQueuedMessage[]
        >(threadQueuedMessagesQueryKey("thread-1"))
        ?.map((queuedMessage) => queuedMessage.id),
    ).toEqual(["qmsg-2"]);

    rollbackRemoveQueuedMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        queuedMessageId: "qmsg-1",
      },
      transaction,
    });

    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual(previousQueue);
  });

  it("optimistically projects sent queued messages into the timeline", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    const previousQueue = [makeQueuedMessage({ id: "qmsg-1" })];
    queryClient.setQueryData(
      threadQueuedMessagesQueryKey("thread-1"),
      previousQueue,
    );
    queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );

    const transaction = await beginSendQueuedMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        mode: "auto",
        queuedMessageId: "qmsg-1",
      },
    });

    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual([]);
    const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
    expect(timeline?.rows).toHaveLength(1);
    expect(timeline?.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "Queued message",
    });

    rollbackRemoveQueuedMessageTransaction({
      queryClient,
      request: {
        id: "thread-1",
        queuedMessageId: "qmsg-1",
      },
      transaction,
    });

    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual(previousQueue);
    expect(
      queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      )?.rows,
    ).toEqual([]);
  });
});
