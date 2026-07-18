// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { ExistingThreadExecutionInputSources } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BbHttpError, sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { threadQueuedMessagesQueryKey } from "../queries/query-keys";
import {
  useCreateThreadQueuedMessage,
  useDeleteThreadQueuedMessage,
  useSetThreadQueuedMessageGroupBoundary,
  useSendThreadMessage,
} from "./thread-runtime-mutations";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        queuedMessages: {
          create: vi.fn(),
          delete: vi.fn(),
          setGroupBoundary: vi.fn(),
        },
        send: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: {
    getConnectionState: vi.fn(() => "connected"),
  },
}));

function makeQueuedMessage(
  message: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  return {
    id: "qmsg-1",
    content: [{ type: "text", text: "Queued message", mentions: [] }],
    model: "codex-test",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    createdAt: 1,
    updatedAt: 1,
    ...message,
  };
}

const executionInputSources = {
  model: "explicit",
  serviceTier: "client-preference",
  reasoningLevel: "explicit",
  permissionMode: "client-preference",
} satisfies ExistingThreadExecutionInputSources;

beforeEach(() => {
  vi.mocked(sdk.threads.send).mockResolvedValue({ ok: true });
  vi.mocked(sdk.threads.queuedMessages.create).mockResolvedValue(
    makeQueuedMessage(),
  );
  vi.mocked(sdk.threads.queuedMessages.delete).mockResolvedValue({ ok: true });
  vi.mocked(sdk.threads.queuedMessages.setGroupBoundary).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("thread runtime mutations", () => {
  it("forwards execution input sources when sending a thread message", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "thread-1",
        mode: "auto",
        input: [{ type: "text", text: "Run this", mentions: [] }],
        executionInputSources,
      });
    });

    expect(sdk.threads.send).toHaveBeenCalledWith(
      expect.objectContaining({
        executionInputSources,
        threadId: "thread-1",
      }),
    );
  });

  it("forwards execution input sources and sender thread when queueing a message", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useCreateThreadQueuedMessage(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: "thread-1",
        input: [{ type: "text", text: "Queue this", mentions: [] }],
        senderThreadId: "thread-source",
        executionInputSources,
      });
    });

    expect(sdk.threads.queuedMessages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        executionInputSources,
        senderThreadId: "thread-source",
        threadId: "thread-1",
      }),
    );
  });

  it("keeps an optimistically deleted queued message removed when the server says it is already gone", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      makeQueuedMessage({ id: "qmsg-1" }),
      makeQueuedMessage({ id: "qmsg-2" }),
    ]);
    vi.mocked(sdk.threads.queuedMessages.delete).mockRejectedValue(
      new BbHttpError({
        status: 404,
        code: "invalid_request",
        message: "Queued message not found",
        body: {
          code: "invalid_request",
          message: "Queued message not found",
        },
      }),
    );
    const { result } = renderHook(() => useDeleteThreadQueuedMessage(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: "thread-1",
          queuedMessageId: "qmsg-1",
        }),
      ).resolves.toBeUndefined();
    });

    expect(
      queryClient
        .getQueryData<
          ThreadQueuedMessage[]
        >(threadQueuedMessagesQueryKey("thread-1"))
        ?.map((queuedMessage) => queuedMessage.id),
    ).toEqual(["qmsg-2"]);
  });

  it("sets the queued-message group boundary through the API", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useSetThreadQueuedMessageGroupBoundary(),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        id: "thread-1",
        expectedGroupedPrefixQueuedMessageIds: ["qmsg-1", "qmsg-2"],
        groupBoundaryQueuedMessageId: "qmsg-2",
      });
    });

    expect(sdk.threads.queuedMessages.setGroupBoundary).toHaveBeenCalledWith({
      expectedGroupedPrefixQueuedMessageIds: ["qmsg-1", "qmsg-2"],
      groupBoundaryQueuedMessageId: "qmsg-2",
      threadId: "thread-1",
    });
  });
});
