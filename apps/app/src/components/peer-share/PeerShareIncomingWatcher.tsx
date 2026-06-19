import { useEffect, useRef } from "react";
import { appToast } from "@/components/ui/app-toast";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  useAcceptPeerShare,
  useDeclinePeerShare,
  usePeerShareIncoming,
} from "@/hooks/usePeerShare";

/**
 * Mounted once near the app root. Polls for inbound thread offers and raises an
 * AirDrop-style toast for each new one with Accept / Decline actions. Accept
 * imports the shared thread as a read-only local thread (it then appears in the
 * sidebar); Decline drops the offer.
 */
export function PeerShareIncomingWatcher() {
  const incomingQuery = usePeerShareIncoming();
  const acceptShare = useAcceptPeerShare();
  const declineShare = useDeclinePeerShare();
  const promptedIds = useRef(new Set<string>());

  const acceptRef = useRef(acceptShare);
  acceptRef.current = acceptShare;
  const declineRef = useRef(declineShare);
  declineRef.current = declineShare;

  useEffect(() => {
    const shares = incomingQuery.data?.shares ?? [];
    const activeIds = new Set(shares.map((share) => share.id));
    // Forget ids that are no longer pending so a future re-offer can re-prompt.
    for (const id of promptedIds.current) {
      if (!activeIds.has(id)) {
        promptedIds.current.delete(id);
      }
    }
    for (const share of shares) {
      if (promptedIds.current.has(share.id)) {
        continue;
      }
      promptedIds.current.add(share.id);
      appToast.message(`${share.senderName} sent you a thread`, {
        description: share.threadTitle,
        duration: Infinity,
        action: {
          label: "Accept",
          onClick: () => {
            acceptRef.current.mutate(share.id, {
              onSuccess: () =>
                appToast.success(`Imported "${share.threadTitle}"`),
              onError: (error) =>
                appToast.error(
                  getMutationErrorMessage({
                    error,
                    fallbackMessage: "Failed to import thread",
                  }),
                ),
            });
          },
        },
        cancel: {
          label: "Decline",
          onClick: () => {
            declineRef.current.mutate(share.id);
          },
        },
      });
    }
  }, [incomingQuery.data]);

  return null;
}
