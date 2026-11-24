import { useCallback } from "react";
import { useStopThread } from "@/hooks/mutations/thread-runtime-mutations";
import { sdk } from "@/lib/sdk";

interface PendingInteractionCancelTarget {
  interactionId: string;
  threadId: string;
  origin: "plugin" | "provider";
}

export function usePendingInteractionCancel({
  interactionId,
  threadId,
  origin,
}: PendingInteractionCancelTarget): {
  cancel: () => Promise<void>;
  isStopping: boolean;
} {
  const stopThread = useStopThread();
  const stop = stopThread.mutateAsync;
  const cancel = useCallback(async () => {
    if (origin === "provider") {
      await stop(threadId);
      return;
    }
    await sdk.threads.interactions.cancel({ interactionId, threadId });
  }, [interactionId, origin, stop, threadId]);
  return { cancel, isStopping: stopThread.isPending };
}
