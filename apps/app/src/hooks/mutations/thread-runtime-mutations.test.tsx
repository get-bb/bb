// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { ExistingThreadExecutionInputSources } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { threadQueuedMessagesQueryKey } from "../queries/query-keys";
import {
  useCreateThreadQueuedMessage,
  useDeleteThreadQueuedMessage,
  useSendThreadMessage,
} from "./thread-runtime-mutations";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createThreadQueuedMessage: vi.fn(),
    deleteThreadQueuedMessage: vi.fn(),
    sendThreadMessage: vi.fn(),
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
    permissionMode: "readonly",
    serviceTier: "default",
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
  vi.mocked(api.sendThreadMessage).mockResolvedValue(undefined);
  vi.mocked(api.createThreadQueuedMessage).mockResolvedValue(
    makeQueuedMessage(),
  );
  vi.mocked(api.deleteThreadQueuedMessage).mockResolvedValue(undefined);
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

    expect(api.sendThreadMessage).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        executionInputSources,
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

    expect(api.createThreadQueuedMessage).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        executionInputSources,
        senderThreadId: "thread-source",
      }),
    );
  });

  it("keeps an optimistically deleted queued message removed when the server says it is already gone", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      makeQueuedMessage({ id: "qmsg-1" }),
      makeQueuedMessage({ id: "qmsg-2" }),
    ]);
    vi.mocked(api.deleteThreadQueuedMessage).mockRejectedValue(
      new api.HttpError({
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
});
