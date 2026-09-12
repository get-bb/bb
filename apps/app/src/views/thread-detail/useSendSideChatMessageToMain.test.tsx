// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadTimelineRows } from "@/components/thread/timeline/ThreadTimelineRows";
import { useCreateThreadQueuedMessage } from "@/hooks/mutations/thread-runtime-mutations";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSendSideChatMessageToMain } from "./useSendSideChatMessageToMain";

const recordConversationMessageContentRender = vi.hoisted(() => vi.fn());

vi.mock(
  "@/components/thread/timeline/ConversationMessageContent",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/thread/timeline/ConversationMessageContent")
      >();
    function CountedConversationMessageContent(
      props: ComponentProps<typeof actual.ConversationMessageContent>,
    ) {
      recordConversationMessageContentRender();
      return <actual.ConversationMessageContent {...props} />;
    }
    return {
      ...actual,
      ConversationMessageContent: CountedConversationMessageContent,
    };
  },
);

afterEach(() => {
  cleanup();
  recordConversationMessageContentRender.mockClear();
});

type CreateQueuedMessageMutate = ReturnType<
  typeof useCreateThreadQueuedMessage
>["mutate"];

const SIDE_CHAT_THREAD_ID = "thr_side_chat";
const SOURCE_THREAD_ID = "thr_source";

const SIDE_CHAT_ROWS = [
  conversationRow({
    id: "side_chat_question",
    role: "user",
    sourceSeqStart: 1,
    text: "What should the main thread do next?",
    threadId: SIDE_CHAT_THREAD_ID,
  }),
  conversationRow({
    id: "side_chat_answer",
    role: "assistant",
    sourceSeqStart: 2,
    text: "Send this plan to the main thread.",
    threadId: SIDE_CHAT_THREAD_ID,
  }),
];

function SideChatTimelineHarness({ revision }: { revision: number }) {
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const handleSendToMainMessage = useSendSideChatMessageToMain({
    createQueuedMessage,
    isSideChatThread: true,
    threadId: SIDE_CHAT_THREAD_ID,
    threadSourceThreadId: SOURCE_THREAD_ID,
  });
  return (
    <div data-revision={revision}>
      <ThreadTimelineRows
        onSendToMainMessage={handleSendToMainMessage}
        threadId={SIDE_CHAT_THREAD_ID}
        threadRuntimeDisplayStatus="idle"
        timelineRows={SIDE_CHAT_ROWS}
        workspaceRootPath={undefined}
      />
    </div>
  );
}

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

  it("does not re-render side-chat timeline messages when the parent re-renders", () => {
    const { wrapper: QueryWrapper } = createQueryClientTestHarness();
    const view = render(
      <MemoryRouter>
        <QueryWrapper>
          <SideChatTimelineHarness revision={1} />
        </QueryWrapper>
      </MemoryRouter>,
    );
    expect(
      view.getAllByRole("button", { name: "Send to main thread" }).length,
    ).toBeGreaterThan(0);
    const settledRenderCount =
      recordConversationMessageContentRender.mock.calls.length;
    expect(settledRenderCount).toBeGreaterThan(0);

    view.rerender(
      <MemoryRouter>
        <QueryWrapper>
          <SideChatTimelineHarness revision={2} />
        </QueryWrapper>
      </MemoryRouter>,
    );

    expect(recordConversationMessageContentRender).toHaveBeenCalledTimes(
      settledRenderCount,
    );
  });
});
