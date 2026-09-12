import { useCallback } from "react";
import type { ThreadTimelineSendToMainMessageHandler } from "@/components/thread/timeline";
import type { useCreateThreadQueuedMessage } from "@/hooks/mutations/thread-runtime-mutations";

type CreateThreadQueuedMessageMutation = ReturnType<
  typeof useCreateThreadQueuedMessage
>;

interface UseSendSideChatMessageToMainArgs {
  createQueuedMessage: Pick<
    CreateThreadQueuedMessageMutation,
    "isPending" | "mutate"
  >;
  isSideChatThread: boolean;
  threadId: string | undefined;
  threadSourceThreadId: string | null;
}

export function useSendSideChatMessageToMain({
  createQueuedMessage,
  isSideChatThread,
  threadId,
  threadSourceThreadId,
}: UseSendSideChatMessageToMainArgs): ThreadTimelineSendToMainMessageHandler {
  const { isPending, mutate } = createQueuedMessage;
  return useCallback<ThreadTimelineSendToMainMessageHandler>(
    (target) => {
      if (
        threadId === undefined ||
        !isSideChatThread ||
        threadSourceThreadId === null ||
        isPending
      ) {
        return;
      }

      mutate({
        id: threadSourceThreadId,
        input: [{ type: "text", text: target.messageText, mentions: [] }],
        senderThreadId: threadId,
      });
    },
    [isPending, isSideChatThread, mutate, threadId, threadSourceThreadId],
  );
}
