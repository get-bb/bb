import type { ThreadQueuedMessage } from "@bb/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { threadQueuedMessagesQueryKey } from "@/lib/query/query-keys";
import { toast } from "@/ui";

interface UseSendMessageToMainThreadArgs {
  /** The side chat's source thread; null when this is not a side chat. */
  mainThreadId: string | null;
  sideChatThreadId: string | null;
}

/**
 * Side chats only: "Send to main thread" queues the agent message on the
 * main thread as a message from the side chat (web
 * `sendSideChatMessageToMain`). Returns null when not applicable so the
 * action stays out of the sheet.
 */
export function useSendMessageToMainThread({
  mainThreadId,
  sideChatThreadId,
}: UseSendMessageToMainThreadArgs):
  | ((target: { messageText: string }) => void)
  | null {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const mutation = useMutation<
    ThreadQueuedMessage,
    Error,
    { mainThreadId: string; sideChatThreadId: string; messageText: string }
  >({
    meta: { errorMessage: "Failed to send message to the main thread." },
    mutationFn: (request) =>
      sdk.threads.queuedMessages.create({
        threadId: request.mainThreadId,
        input: [{ type: "text", text: request.messageText, mentions: [] }],
        senderThreadId: request.sideChatThreadId,
      }),
    onSuccess: (_message, variables) => {
      void queryClient.invalidateQueries({
        queryKey: threadQueuedMessagesQueryKey(variables.mainThreadId),
      });
      toast.success("Queued on the main thread");
    },
  });
  const { mutate, isPending } = mutation;
  const send = useCallback(
    ({ messageText }: { messageText: string }) => {
      if (mainThreadId === null || sideChatThreadId === null || isPending) {
        return;
      }
      mutate({ mainThreadId, sideChatThreadId, messageText });
    },
    [isPending, mainThreadId, mutate, sideChatThreadId],
  );
  return mainThreadId !== null && sideChatThreadId !== null ? send : null;
}
