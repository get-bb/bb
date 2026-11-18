import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { QueuedMessageEditRequest } from "@/components/promptbox/banner/LazyQueuedMessagesList";
import type { PromptDraftState } from "@bb/client-core";
import {
  arePromptDraftStatesEqual,
  isPromptDraftEmpty,
  queuedInputToDraft,
} from "@bb/client-core";
import { useLatestRef } from "@/hooks/useLatestRef";
import type { InlineComposerDraftSession } from "./useActiveComposerDraft";
import { useQueuedMessageEditHold } from "./useQueuedMessageEditHold";

export interface InlineQueuedMessageEditState {
  draft: PromptDraftState;
  initialDraft: PromptDraftState;
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
  onUnsavedEditLost: (draft: PromptDraftState) => void;
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
  abandonInlineQueuedMessageEdit: () => void;
  beginEditQueuedMessage: (request: QueuedMessageEditRequest) => void;
  queuedMessageDraftSession: InlineComposerDraftSession | null;
}

function hasUnsavedChanges(edit: InlineQueuedMessageEditState): boolean {
  return (
    !isPromptDraftEmpty(edit.draft) &&
    !arePromptDraftStatesEqual(edit.draft, edit.initialDraft)
  );
}

function isLiveInlineQueuedMessageEdit(
  edit: InlineQueuedMessageEditState,
  ownerThreadId: string,
  queuedMessages: readonly ThreadQueuedMessage[],
): boolean {
  return (
    edit.ownerThreadId === ownerThreadId &&
    queuedMessages.some((message) => message.id === edit.queuedMessageId)
  );
}

export function useInlineQueuedMessageEditing({
  ownerThreadId,
  queuedMessages,
  onBeginEdit,
  onUnsavedEditLost,
}: UseInlineQueuedMessageEditingArgs): UseInlineQueuedMessageEditingResult {
  const onUnsavedEditLostRef = useLatestRef(onUnsavedEditLost);
  const [inlineEditingQueuedMessageState, setInlineEditingQueuedMessage] =
    useState<InlineQueuedMessageEditState | null>(null);
  const inlineEditingQueuedMessageRef =
    useRef<InlineQueuedMessageEditState | null>(null);
  const inlineEditSessionIdRef = useRef(0);

  const queuedMessagesById = useMemo(() => {
    const next = new Map<string, ThreadQueuedMessage>();
    for (const message of queuedMessages) {
      next.set(message.id, message);
    }
    return next;
  }, [queuedMessages]);
  const queuedMessagesByIdRef =
    useRef<ReadonlyMap<string, ThreadQueuedMessage>>(queuedMessagesById);
  useLayoutEffect(() => {
    queuedMessagesByIdRef.current = queuedMessagesById;
  });

  const commitInlineQueuedMessage = useCallback(
    (next: InlineQueuedMessageEditState | null) => {
      inlineEditingQueuedMessageRef.current = next;
      setInlineEditingQueuedMessage(next);
    },
    [],
  );
  const updateInlineQueuedMessage = useCallback(
    (
      updater: (
        current: InlineQueuedMessageEditState | null,
      ) => InlineQueuedMessageEditState | null,
    ) => {
      setInlineEditingQueuedMessage((current) => {
        const next = updater(current);
        inlineEditingQueuedMessageRef.current = next;
        return next;
      });
    },
    [],
  );
  const dismissInlineQueuedMessageEditor = useCallback(() => {
    commitInlineQueuedMessage(null);
  }, [commitInlineQueuedMessage]);
  const recoverUnsavedEdit = useCallback(
    (edit: InlineQueuedMessageEditState) => {
      if (hasUnsavedChanges(edit)) {
        onUnsavedEditLostRef.current(edit.draft);
      }
    },
    [onUnsavedEditLostRef],
  );
  const abandonInlineQueuedMessageEdit = useCallback(() => {
    const current = inlineEditingQueuedMessageRef.current;
    if (current !== null) {
      recoverUnsavedEdit(current);
    }
    commitInlineQueuedMessage(null);
  }, [commitInlineQueuedMessage, recoverUnsavedEdit]);

  const inlineEditingQueuedMessage = useMemo(
    () =>
      inlineEditingQueuedMessageState !== null &&
      isLiveInlineQueuedMessageEdit(
        inlineEditingQueuedMessageState,
        ownerThreadId,
        queuedMessages,
      )
        ? inlineEditingQueuedMessageState
        : null,
    [inlineEditingQueuedMessageState, ownerThreadId, queuedMessages],
  );
  if (
    inlineEditingQueuedMessageState !== null &&
    inlineEditingQueuedMessage === null
  ) {
    setInlineEditingQueuedMessage(null);
  }
  useEffect(() => {
    const current = inlineEditingQueuedMessageRef.current;
    if (
      current !== null &&
      !isLiveInlineQueuedMessageEdit(current, ownerThreadId, queuedMessages)
    ) {
      inlineEditingQueuedMessageRef.current = null;
      if (current.ownerThreadId === ownerThreadId) {
        recoverUnsavedEdit(current);
      }
    }
  }, [ownerThreadId, queuedMessages, recoverUnsavedEdit]);
  useQueuedMessageEditHold({
    queuedMessageId: inlineEditingQueuedMessage?.queuedMessageId ?? null,
    threadId: inlineEditingQueuedMessage?.ownerThreadId ?? null,
    onRejected: abandonInlineQueuedMessageEdit,
  });

  const beginEditQueuedMessage = useCallback(
    ({ queuedMessageId, queuedMessageIndex }: QueuedMessageEditRequest) => {
      const queuedMessage = queuedMessagesByIdRef.current.get(queuedMessageId);
      if (!queuedMessage) {
        return;
      }
      const initialDraft = queuedInputToDraft(queuedMessage.content);
      commitInlineQueuedMessage({
        draft: initialDraft,
        initialDraft,
        editSessionId: (inlineEditSessionIdRef.current += 1),
        expectedUpdatedAt: queuedMessage.updatedAt,
        model: queuedMessage.model,
        ownerThreadId,
        permissionMode: queuedMessage.permissionMode,
        queuedMessageId,
        queuedMessageIndex,
        reasoningLevel: queuedMessage.reasoningLevel,
        serviceTier: queuedMessage.serviceTier,
      });
      onBeginEdit?.();
    },
    [commitInlineQueuedMessage, onBeginEdit, ownerThreadId],
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
    abandonInlineQueuedMessageEdit,
    beginEditQueuedMessage,
    queuedMessageDraftSession,
  };
}
