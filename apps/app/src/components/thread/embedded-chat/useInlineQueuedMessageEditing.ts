import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  threadQueuedMessageSchema,
  type ThreadQueuedMessage,
} from "@bb/domain";
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
  clearInlineQueuedMessageEditor: (
    expected?: InlineQueuedMessageEditState,
  ) => void;
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
  const ownerThreadIdRef = useRef(ownerThreadId);
  ownerThreadIdRef.current = ownerThreadId;
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
              settings: {
                model: next.model,
                reasoningLevel: next.reasoningLevel,
                permissionMode: next.permissionMode,
                serviceTier: next.serviceTier,
                updatedAt: next.expectedUpdatedAt,
              },
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
                settings: {
                  model: next.model,
                  reasoningLevel: next.reasoningLevel,
                  permissionMode: next.permissionMode,
                  serviceTier: next.serviceTier,
                  updatedAt: next.expectedUpdatedAt,
                },
              }),
            );
          } catch {}
        }
        return next;
      });
    },
    [],
  );
  const clearInlineQueuedMessageEditor = useCallback(
    (expected?: InlineQueuedMessageEditState) => {
      if (expected) {
        try {
          const key = `bb:queued-edit:${expected.ownerThreadId}`;
          const stored = z
            .object({
              queuedMessageId: z.string(),
              editToken: z.string(),
              draft: z.string().nullable(),
            })
            .safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
          if (
            stored.success &&
            stored.data.queuedMessageId === expected.queuedMessageId &&
            stored.data.editToken === expected.editToken &&
            stored.data.draft === serializePromptDraftStorage(expected.draft)
          )
            sessionStorage.removeItem(key);
        } catch {}
      }
      if (!mountedRef.current) return;
      const current = inlineEditingQueuedMessageRef.current;
      if (
        expected &&
        (!current ||
          current.ownerThreadId !== expected.ownerThreadId ||
          current.queuedMessageId !== expected.queuedMessageId ||
          current.editToken !== expected.editToken ||
          current.editSessionId !== expected.editSessionId ||
          serializePromptDraftStorage(current.draft) !==
            serializePromptDraftStorage(expected.draft))
      )
        return;
      if (current) {
        try {
          sessionStorage.removeItem(`bb:queued-edit:${current.ownerThreadId}`);
        } catch {}
      }
      commitInlineQueuedMessage(null);
    },
    [commitInlineQueuedMessage],
  );
  const dismissInlineQueuedMessageEditor = useCallback(() => {
    if (!mountedRef.current) return;
    const current = inlineEditingQueuedMessageRef.current;
    if (!current || requestPendingRef.current) return;
    const row = queuedMessagesByIdRef.current.get(current.queuedMessageId);
    if (
      !row ||
      (row.updatedAt >= current.expectedUpdatedAt &&
        row.editToken !== current.editToken)
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
      .then(() => clearInlineQueuedMessageEditor(current))
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
      inlineEditingQueuedMessageState.ownerThreadId === ownerThreadId
        ? inlineEditingQueuedMessageState
        : null,
    [inlineEditingQueuedMessageState, ownerThreadId],
  );
  useEffect(() => {
    if (
      inlineEditingQueuedMessageState &&
      inlineEditingQueuedMessageState.ownerThreadId !== ownerThreadId
    ) {
      commitInlineQueuedMessage(null);
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
          clearInlineQueuedMessageEditor(previous);
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
        if (!mountedRef.current || ownerThreadIdRef.current !== ownerThreadId)
          return;
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
    if (inlineEditingQueuedMessageState) return;
    try {
      const stored = z
        .object({
          queuedMessageId: z.string(),
          editToken: z.string(),
          draft: z.string().nullable(),
          settings: threadQueuedMessageSchema.pick({
            model: true,
            reasoningLevel: true,
            permissionMode: true,
            serviceTier: true,
            updatedAt: true,
          }),
        })
        .safeParse(
          JSON.parse(
            sessionStorage.getItem(`bb:queued-edit:${ownerThreadId}`) ?? "null",
          ),
        );
      if (!stored.success) return;
      const index = queuedMessages.findIndex(
        (row) => row.id === stored.data.queuedMessageId,
      );
      const row = queuedMessages[index];
      const ownsRow = row?.editToken === stored.data.editToken;
      commitInlineQueuedMessage({
        draft: parsePromptDraftStorage(stored.data.draft),
        editToken: stored.data.editToken,
        editSessionId: (inlineEditSessionIdRef.current += 1),
        expectedUpdatedAt: ownsRow
          ? row.updatedAt
          : stored.data.settings.updatedAt,
        model: stored.data.settings.model,
        ownerThreadId,
        permissionMode: stored.data.settings.permissionMode,
        queuedMessageId: stored.data.queuedMessageId,
        queuedMessageIndex: index,
        reasoningLevel: stored.data.settings.reasoningLevel,
        serviceTier: stored.data.settings.serviceTier,
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
          if (current === null || current.editSessionId !== editSessionId)
            return;
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
        !queuedMessages.some(
          (row) =>
            row.id === inlineEditingQueuedMessage.queuedMessageId &&
            row.editToken === inlineEditingQueuedMessage.editToken,
        )),
  };
}
