// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateThreadQueuedMessage } from "@/hooks/mutations/thread-runtime-mutations";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSendSideChatMessageToMain } from "./useSendSideChatMessageToMain";

afterEach(cleanup);

type CreateQueuedMessageMutate = ReturnType<
  typeof useCreateThreadQueuedMessage
>["mutate"];

const SIDE_CHAT_THREAD_ID = "thr_side_chat";
const SOURCE_THREAD_ID = "thr_source";

describe("useSendSideChatMessageToMain", () => {
  it("keeps the callback identity when the mutation result object changes", () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      () => {
        const createQueuedMessage = useCreateThreadQueuedMessage();
        const sendToMain = useSendSideChatMessageToMain({
          createQueuedMessage,
          isSideChatThread: true,
          threadId: SIDE_CHAT_THREAD_ID,
          threadSourceThreadId: SOURCE_THREAD_ID,
        });
        return { createQueuedMessage, sendToMain };
      },
      { wrapper },
    );
    const initial = result.current;

    rerender();

    expect(result.current.createQueuedMessage).not.toBe(
      initial.createQueuedMessage,
    );
    expect(result.current.createQueuedMessage.mutate).toBe(
      initial.createQueuedMessage.mutate,
    );
    expect(result.current.sendToMain).toBe(initial.sendToMain);
  });

  it("ignores sends while the mutation is pending and queues one message otherwise", () => {
    const mutate = vi.fn<CreateQueuedMessageMutate>();
    const { result, rerender } = renderHook(
      ({ isPending }: { isPending: boolean }) =>
        useSendSideChatMessageToMain({
          createQueuedMessage: { isPending, mutate },
          isSideChatThread: true,
          threadId: SIDE_CHAT_THREAD_ID,
          threadSourceThreadId: SOURCE_THREAD_ID,
        }),
      { initialProps: { isPending: true } },
    );

    result.current({ messageText: "Send this plan to the main thread." });
    expect(mutate).not.toHaveBeenCalled();

    rerender({ isPending: false });
    result.current({ messageText: "Send this plan to the main thread." });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      id: SOURCE_THREAD_ID,
      input: [
        {
          type: "text",
          text: "Send this plan to the main thread.",
          mentions: [],
        },
      ],
      senderThreadId: SIDE_CHAT_THREAD_ID,
    });
  });

  it.each([
    {
      isSideChatThread: false,
      name: "the thread is not a side chat",
      threadId: SIDE_CHAT_THREAD_ID,
      threadSourceThreadId: SOURCE_THREAD_ID,
    },
    {
      isSideChatThread: true,
      name: "the side chat has no source thread",
      threadId: SIDE_CHAT_THREAD_ID,
      threadSourceThreadId: null,
    },
    {
      isSideChatThread: true,
      name: "the thread has not loaded",
      threadId: undefined,
      threadSourceThreadId: SOURCE_THREAD_ID,
    },
  ])(
    "does not queue a message when $name",
    ({ isSideChatThread, threadId, threadSourceThreadId }) => {
      const mutate = vi.fn<CreateQueuedMessageMutate>();
      const { result } = renderHook(() =>
        useSendSideChatMessageToMain({
          createQueuedMessage: { isPending: false, mutate },
          isSideChatThread,
          threadId,
          threadSourceThreadId,
        }),
      );

      result.current({ messageText: "Send this plan to the main thread." });

      expect(mutate).not.toHaveBeenCalled();
    },
  );
});
