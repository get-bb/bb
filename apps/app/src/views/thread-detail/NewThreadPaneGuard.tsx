import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "jotai";
import { emptyPromptDraftState, isPromptDraftEmpty } from "@bb/client-core";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { registerNewThreadPaneGuard } from "@/lib/split-layout/newThreadPaneGuard";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";

interface PendingDiscard {
  paneIds: string[];
  accept: () => void;
  cancel: () => void;
}

export function NewThreadPaneGuard() {
  const store = useStore();
  const creating = useRef(new Set<string>());
  const [pending, setPending] = useState<PendingDiscard | null>(null);
  const pendingRef = useRef<PendingDiscard | null>(null);
  useLayoutEffect(
    () =>
      registerNewThreadPaneGuard(store, {
        isCreating: (paneId) => creating.current.has(paneId),
        setCreating: (paneId, value) => {
          if (value) creating.current.add(paneId);
          else creating.current.delete(paneId);
        },
        discard: (paneIds, accept, cancel) => {
          if (pendingRef.current !== null) {
            cancel();
            return;
          }
          const clearAndAccept = () => {
            if (paneIds.some((paneId) => creating.current.has(paneId))) {
              cancel();
              return;
            }
            if (!accept()) return;
            for (const key of paneIds) {
              getPromptDraftAccessor({ kind: "new-thread", key }).setDraft(
                emptyPromptDraftState(),
              );
            }
          };
          if (
            paneIds.every((key) =>
              isPromptDraftEmpty(
                getPromptDraftAccessor({
                  kind: "new-thread",
                  key,
                }).getCurrent(),
              ),
            )
          ) {
            clearAndAccept();
            return;
          }
          const request = { paneIds, accept: clearAndAccept, cancel };
          pendingRef.current = request;
          setPending(request);
        },
      }),
    [store],
  );
  const finish = (discard: boolean) => {
    const request = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (discard) request?.accept();
    else request?.cancel();
  };
  return (
    <ConfirmDeleteDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <ConfirmDeleteDialogContent
        title="Discard new thread?"
        description="The text and attachments in this composer will be discarded."
        confirmLabel="Discard"
        pending={false}
        onConfirm={() => finish(true)}
        onCancel={() => finish(false)}
      />
    </ConfirmDeleteDialog>
  );
}
