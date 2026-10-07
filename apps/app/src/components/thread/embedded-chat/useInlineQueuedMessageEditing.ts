import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { QueuedMessageEditRequest } from "@/components/promptbox/banner/LazyQueuedMessagesList";
import type { PromptDraftState } from "@bb/client-core";
import {
  parsePromptDraftStorage,
  serializePromptDraftStorage,
  queuedInputToDraft,
} from "@bb/client-core";
import { z } from "zod";
import {
  useBeginThreadQueuedMessageEdit,
  useCancelThreadQueuedMessageEdit,
} from "@/hooks/mutations/thread-runtime-mutations";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import type { InlineComposerDraftSession } from "./useActiveComposerDraft";

export interface InlineQueuedMessageEditState {
  draft: PromptDraftState;
  editToken: string;
  editSessionId: number;
  expectedUpdatedAt: number;
  model: ThreadQueuedMessage["model"];
  ownerThreadId: string;
  permissionMode: ThreadQueuedMessage["permissionMode"];
  queuedMessageId: string;
  queuedMessageIndex: number;
  reasoningLevel: ThreadQueuedMessage["reasoningLevel"];
  serviceTier: ThreadQueuedMessage["serviceTier"];
}

interface UseInlineQueuedMessageEditingArgs {
  ownerThreadId: string;
  queuedMessages: readonly ThreadQueuedMessage[];
  onBeginEdit?: () => void;
}

interface UseInlineQueuedMessageEditingResult {
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null;
  inlineEditingQueuedMessageRef: React.RefObject<InlineQueuedMessageEditState | null>;
  commitInlineQueuedMessage: (
    next: InlineQueuedMessageEditState | null,
  ) => void;
  updateInlineQueuedMessage: (
    updater: (
      current: InlineQueuedMessageEditState | null,
    ) => InlineQueuedMessageEditState | null,
  ) => void;
  dismissInlineQueuedMessageEditor: () => void;
  clearInlineQueuedMessageEditor: () => void;
  cancelHeldQueuedMessageEdit: (queuedMessageId: string) => void;
  beginEditQueuedMessage: (request: QueuedMessageEditRequest) => void;
  queuedMessageDraftSession: InlineComposerDraftSession | null;
  queuedEditActionPending: boolean;
}

export function useInlineQueuedMessageEditing({
  ownerThreadId,
  queuedMessages,
  onBeginEdit,
}: UseInlineQueuedMessageEditingArgs): UseInlineQueuedMessageEditingResult {
  const beginEdit = useBeginThreadQueuedMessageEdit();
  const cancelEdit = useCancelThreadQueuedMessageEdit();
  const requestPendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [inlineEditingQueuedMessageState, setInlineEditingQueuedMessage] =
    useState<InlineQueuedMessageEditState | null>(null);
  const inlineEditingQueuedMessageRef =
    useRef<InlineQueuedMessageEditState | null>(null);
  const inlineEditSessionIdRef = useRef(0);

  const queuedMessagesByIdRef = useRef<
    ReadonlyMap<string, ThreadQueuedMessage>
  >(new Map());
  queuedMessagesByIdRef.current = useMemo(() => {
    const next = new Map<string, ThreadQueuedMessage>();
    for (const message of queuedMessages) {
      next.set(message.id, message);
    }
    return next;
  }, [queuedMessages]);

  const commitInlineQueuedMessage = useCallback(
    (next: InlineQueuedMessageEditState | null) => {
      if (!mountedRef.current) return;
      inlineEditingQueuedMessageRef.current = next;
      setInlineEditingQueuedMessage(next);
      if (next) {
        try {
          sessionStorage.setItem(
            `bb:queued-edit:${next.ownerThreadId}`,
            JSON.stringify({
              queuedMessageId: next.queuedMessageId,
              editToken: next.editToken,
              draft: serializePromptDraftStorage(next.draft),
            }),
          );
        } catch {}
      }
    },
    [],
  );
  const updateInlineQueuedMessage = useCallback(
    (
      updater: (
        current: InlineQueuedMessageEditState | null,
      ) => InlineQueuedMessageEditState | null,
    ) => {
      if (!mountedRef.current) return;
      setInlineEditingQueuedMessage((current) => {
        const next = updater(current);
        inlineEditingQueuedMessageRef.current = next;
        if (next) {
          try {
            sessionStorage.setItem(
              `bb:queued-edit:${next.ownerThreadId}`,
              JSON.stringify({
                queuedMessageId: next.queuedMessageId,
                editToken: next.editToken,
                draft: serializePromptDraftStorage(next.draft),
              }),
            );
          } catch {}
        }
        return next;
      });
    },
    [],
  );
  const clearInlineQueuedMessageEditor = useCallback(() => {
    if (!mountedRef.current) return;
    const current = inlineEditingQueuedMessageRef.current;
    if (current) {
      try {
        sessionStorage.removeItem(`bb:queued-edit:${current.ownerThreadId}`);
      } catch {}
    }
    commitInlineQueuedMessage(null);
  }, [commitInlineQueuedMessage]);
  const dismissInlineQueuedMessageEditor = useCallback(() => {
    if (!mountedRef.current) return;
    const current = inlineEditingQueuedMessageRef.current;
    if (!current || requestPendingRef.current) return;
    const row = queuedMessagesByIdRef.current.get(current.queuedMessageId);
    if (
      row &&
      row.updatedAt >= current.expectedUpdatedAt &&
      row.editToken !== current.editToken
    ) {
      clearInlineQueuedMessageEditor();
      return;
    }
    requestPendingRef.current = true;
    void cancelEdit
      .mutateAsync({
        id: current.ownerThreadId,
        queuedMessageId: current.queuedMessageId,
        expectedUpdatedAt: current.expectedUpdatedAt,
        editToken: current.editToken,
      })
      .then(clearInlineQueuedMessageEditor)
      .catch((error) =>
        showMutationErrorToast({
          error,
          fallbackMessage: "Failed to cancel queued edit",
        }),
      )
      .finally(() => {
        requestPendingRef.current = false;
      });
  }, [cancelEdit, clearInlineQueuedMessageEditor]);

  const inlineEditingQueuedMessage = useMemo(
    () =>
      inlineEditingQueuedMessageState !== null &&
      inlineEditingQueuedMessageState.ownerThreadId === ownerThreadId &&
      queuedMessages.some(
        (message) =>
          message.id === inlineEditingQueuedMessageState.queuedMessageId,
      )
        ? inlineEditingQueuedMessageState
        : null,
    [inlineEditingQueuedMessageState, ownerThreadId, queuedMessages],
  );
  useEffect(() => {
    if (
      inlineEditingQueuedMessageState &&
      inlineEditingQueuedMessageState.ownerThreadId !== ownerThreadId
    ) {
      commitInlineQueuedMessage(null);
    } else if (inlineEditingQueuedMessageState && !inlineEditingQueuedMessage) {
      clearInlineQueuedMessageEditor();
    }
  }, [
    ownerThreadId,
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageState,
    clearInlineQueuedMessageEditor,
    commitInlineQueuedMessage,
  ]);

  useEffect(() => {
    const current = inlineEditingQueuedMessageRef.current;
    const index = current
      ? queuedMessages.findIndex(
          (row) =>
            row.id === current.queuedMessageId &&
            row.editToken === current.editToken,
        )
      : -1;
    const row = queuedMessages[index];
    if (
      current &&
      row &&
      (row.updatedAt !== current.expectedUpdatedAt ||
        index !== current.queuedMessageIndex)
    ) {
      commitInlineQueuedMessage({
        ...current,
        expectedUpdatedAt: row.updatedAt,
        queuedMessageIndex: index,
      });
    }
  }, [queuedMessages, commitInlineQueuedMessage]);

  const beginEditQueuedMessage = useCallback(
    ({ queuedMessageId, queuedMessageIndex }: QueuedMessageEditRequest) => {
      if (!mountedRef.current) return;
      const queuedMessage = queuedMessagesByIdRef.current.get(queuedMessageId);
      if (!queuedMessage || requestPendingRef.current) return;
      requestPendingRef.current = true;
      void (async () => {
        const previous = inlineEditingQueuedMessageRef.current;
        if (previous) {
          await cancelEdit.mutateAsync({
            id: previous.ownerThreadId,
            queuedMessageId: previous.queuedMessageId,
            expectedUpdatedAt: previous.expectedUpdatedAt,
            editToken: previous.editToken,
          });
          clearInlineQueuedMessageEditor();
          if (previous.queuedMessageId === queuedMessageId) return;
        }
        const held = await beginEdit.mutateAsync({
          id: ownerThreadId,
          queuedMessageId,
          expectedUpdatedAt: queuedMessage.updatedAt,
          editToken: queuedMessage.editToken,
        });
        if (held.editToken === null)
          throw new Error("Queue edit was not admitted");
        if (!mountedRef.current) return;
        commitInlineQueuedMessage({
          draft: queuedInputToDraft(held.content),
          editToken: held.editToken,
          editSessionId: (inlineEditSessionIdRef.current += 1),
          expectedUpdatedAt: held.updatedAt,
          model: held.model,
          ownerThreadId,
          permissionMode: held.permissionMode,
          queuedMessageId,
          queuedMessageIndex,
          reasoningLevel: held.reasoningLevel,
          serviceTier: held.serviceTier,
        });
        onBeginEdit?.();
      })()
        .catch((error) =>
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to begin queued edit",
          }),
        )
        .finally(() => {
          requestPendingRef.current = false;
        });
    },
    [
      beginEdit,
      cancelEdit,
      clearInlineQueuedMessageEditor,
      commitInlineQueuedMessage,
      onBeginEdit,
      ownerThreadId,
    ],
  );

  useEffect(() => {
    if (inlineEditingQueuedMessageState || requestPendingRef.current) return;
    try {
      const stored = z
        .object({
          queuedMessageId: z.string(),
          editToken: z.string(),
          draft: z.string().nullable(),
        })
        .safeParse(
          JSON.parse(
            sessionStorage.getItem(`bb:queued-edit:${ownerThreadId}`) ?? "null",
          ),
        );
      if (!stored.success) return;
      const index = queuedMessages.findIndex(
        (row) =>
          row.id === stored.data.queuedMessageId &&
          row.editToken === stored.data.editToken,
      );
      const row = queuedMessages[index];
      if (!row || row.editToken === null) return;
      commitInlineQueuedMessage({
        draft: parsePromptDraftStorage(stored.data.draft),
        editToken: row.editToken,
        editSessionId: (inlineEditSessionIdRef.current += 1),
        expectedUpdatedAt: row.updatedAt,
        model: row.model,
        ownerThreadId,
        permissionMode: row.permissionMode,
        queuedMessageId: row.id,
        queuedMessageIndex: index,
        reasoningLevel: row.reasoningLevel,
        serviceTier: row.serviceTier,
      });
    } catch {}
  }, [
    ownerThreadId,
    queuedMessages,
    inlineEditingQueuedMessageState,
    commitInlineQueuedMessage,
  ]);

  const cancelHeldQueuedMessageEdit = useCallback(
    (queuedMessageId: string) => {
      const row = queuedMessagesByIdRef.current.get(queuedMessageId);
      if (!mountedRef.current || !row?.editToken || requestPendingRef.current)
        return;
      requestPendingRef.current = true;
      void cancelEdit
        .mutateAsync({
          id: ownerThreadId,
          queuedMessageId,
          expectedUpdatedAt: row.updatedAt,
          editToken: row.editToken,
        })
        .catch((error) =>
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to cancel held edit",
          }),
        )
        .finally(() => {
          requestPendingRef.current = false;
        });
    },
    [cancelEdit, ownerThreadId],
  );
  const editSessionId = inlineEditingQueuedMessage?.editSessionId ?? null;
  const queuedMessageDraftSession =
    useMemo<InlineComposerDraftSession | null>(() => {
      if (editSessionId === null) {
        return null;
      }
      return {
        editSessionId,
        setDraft: (update) => {
          const current = inlineEditingQueuedMessageRef.current;
          if (current === null) return;
          commitInlineQueuedMessage({
            ...current,
            draft: update(current.draft),
          });
        },
      };
    }, [commitInlineQueuedMessage, editSessionId]);

  return {
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
    updateInlineQueuedMessage,
    dismissInlineQueuedMessageEditor,
    clearInlineQueuedMessageEditor,
    cancelHeldQueuedMessageEdit,
    beginEditQueuedMessage,
    queuedMessageDraftSession,
    queuedEditActionPending:
      beginEdit.isPending ||
      cancelEdit.isPending ||
      (inlineEditingQueuedMessage !== null &&
        queuedMessages.some(
          (row) =>
            row.id === inlineEditingQueuedMessage.queuedMessageId &&
            row.editToken !== null &&
            row.updatedAt >= inlineEditingQueuedMessage.expectedUpdatedAt &&
            row.editToken !== inlineEditingQueuedMessage.editToken,
        )),
  };
}
