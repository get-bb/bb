import { useEffect, useRef } from "react";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { BbHttpError, sdk } from "@/lib/sdk";

const EDIT_HOLD_RENEWALS_PER_LEASE = 4;
const EDIT_HOLD_RETRY_MS = 5_000;

interface UseQueuedMessageEditHoldArgs {
  queuedMessageId: string | null;
  threadId: string | null;
  onRejected: () => void;
}

export function useQueuedMessageEditHold({
  queuedMessageId,
  threadId,
  onRejected,
}: UseQueuedMessageEditHoldArgs): void {
  const requestChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (queuedMessageId === null || threadId === null) {
      return;
    }
    const target = { queuedMessageId, threadId };
    let active = true;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    const enqueue = (request: () => Promise<void>): Promise<void> => {
      const next = requestChainRef.current.then(request);
      requestChainRef.current = next.catch(() => undefined);
      return next;
    };
    const hold = () => {
      renewTimer = null;
      enqueue(async () => {
        if (!active) return;
        const { leaseMs } =
          await sdk.threads.queuedMessages.experimental_holdForEdit(target);
        if (active) {
          renewTimer = setTimeout(hold, leaseMs / EDIT_HOLD_RENEWALS_PER_LEASE);
        }
      }).catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof BbHttpError &&
          (error.status === 404 || error.status === 409)
        ) {
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to edit queued message",
            lifecycleOperation: "update_queued_message",
          });
          onRejected();
          return;
        }
        renewTimer = setTimeout(hold, EDIT_HOLD_RETRY_MS);
      });
    };
    hold();
    return () => {
      active = false;
      if (renewTimer !== null) {
        clearTimeout(renewTimer);
      }
      enqueue(async () => {
        await sdk.threads.queuedMessages.experimental_releaseEditHold(target);
      }).catch(() => undefined);
    };
  }, [onRejected, queuedMessageId, threadId]);
}
