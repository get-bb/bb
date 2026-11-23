import { useCallback, useContext } from "react";
import { useStopThread } from "@/hooks/mutations/thread-runtime-mutations";
import { sdk } from "@/lib/sdk";
import { InlinePendingInteractionContext } from "./PendingInteractionShell";

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
  closesInline: boolean;
  isStopping: boolean;
} {
  const inline = useContext(InlinePendingInteractionContext);
  const stopThread = useStopThread();
  const stop = stopThread.mutateAsync;
  const cancel = useCallback(async () => {
    if (inline) {
      inline.close();
      return;
    }
    if (origin === "provider") {
      await stop(threadId);
      return;
    }
    await sdk.threads.interactions.cancel({ interactionId, threadId });
  }, [inline, interactionId, origin, stop, threadId]);
  return {
    cancel,
    closesInline: inline !== null,
    isStopping: stopThread.isPending,
  };
}
