import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import type {
  QueuedMessageEditRequest,
  QueuedMessageInlineEditor,
} from "@/components/promptbox/banner/QueuedMessagesList";
import type { PromptDraftState } from "@/lib/prompt-draft";
import { queuedInputToDraft } from "@/views/thread-detail/threadQueuedMessages";

export interface InlineQueuedMessageEditState {
  draft: PromptDraftState;
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
  /** The thread whose queue may be edited inline. Null while no thread exists. */
  ownerThreadId: string | null;
  queuedMessages: readonly ThreadQueuedMessage[];
  /** Called when an edit session starts (e.g. clear attachment errors, focus). */
  onBeginEdit?: () => void;
}

export interface UseInlineQueuedMessageEditingResult {
  /**
   * The live edit session, already filtered against the current owner thread
   * and queue contents — null the moment the edited message leaves the queue.
   */
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null;
  /**
   * Ref kept authoritative synchronously on every commit. React batches state
   * updates, while plugin composer actions may make back-to-back reads and
   * writes in one event — reads through this ref always observe the prior
   * action's draft.
   */
  inlineEditingQueuedMessageRef: React.RefObject<InlineQueuedMessageEditState | null>;
  commitInlineQueuedMessage: (next: InlineQueuedMessageEditState | null) => void;
  /**
   * Functional variant applied against the latest state — for writes that must
   * compose with concurrent (possibly not-yet-committed) updates.
   */
  updateInlineQueuedMessage: (
    updater: (
      current: InlineQueuedMessageEditState | null,
    ) => InlineQueuedMessageEditState | null,
  ) => void;
  dismissInlineQueuedMessageEditor: () => void;
  beginEditQueuedMessage: (request: QueuedMessageEditRequest) => void;
  inlineEditor: QueuedMessageInlineEditor | undefined;
  inlineComposerTarget: HTMLDivElement | null;
  queuedMessagesByIdRef: React.RefObject<ReadonlyMap<string, ThreadQueuedMessage>>;
}

/**
 * The inline queued-message edit session shared by every thread-chat composer:
 * "Edit" on a queued card moves the one live composer into that card's slot,
 * seeded with the queued content, until saved or dismissed. The session
 * self-dismisses when the edited message leaves the queue (sent or deleted
 * elsewhere) or the owning thread changes.
 */
export function useInlineQueuedMessageEditing({
  ownerThreadId,
  queuedMessages,
  onBeginEdit,
}: UseInlineQueuedMessageEditingArgs): UseInlineQueuedMessageEditingResult {
  const [inlineEditingQueuedMessageState, setInlineEditingQueuedMessage] =
    useState<InlineQueuedMessageEditState | null>(null);
  const inlineEditingQueuedMessageRef =
    useRef<InlineQueuedMessageEditState | null>(null);
  const inlineEditSessionIdRef = useRef(0);
  const [inlineComposerTarget, setInlineComposerTarget] =
    useState<HTMLDivElement | null>(null);

  const queuedMessagesByIdRef = useRef<ReadonlyMap<string, ThreadQueuedMessage>>(
    new Map(),
  );
  queuedMessagesByIdRef.current = useMemo(() => {
    const next = new Map<string, ThreadQueuedMessage>();
    for (const message of queuedMessages) {
      next.set(message.id, message);
    }
    return next;
  }, [queuedMessages]);

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
    setInlineComposerTarget(null);
    commitInlineQueuedMessage(null);
  }, [commitInlineQueuedMessage]);

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
      inlineEditingQueuedMessageState !== null &&
      inlineEditingQueuedMessage === null
    ) {
      dismissInlineQueuedMessageEditor();
    }
  }, [
    dismissInlineQueuedMessageEditor,
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageState,
  ]);

  const beginEditQueuedMessage = useCallback(
    ({ queuedMessageId, queuedMessageIndex }: QueuedMessageEditRequest) => {
      if (ownerThreadId === null) {
        return;
      }
      const queuedMessage = queuedMessagesByIdRef.current.get(queuedMessageId);
      if (!queuedMessage) {
        return;
      }
      commitInlineQueuedMessage({
        draft: queuedInputToDraft(queuedMessage.content),
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

  const inlineEditor = useMemo<QueuedMessageInlineEditor | undefined>(
    () =>
      inlineEditingQueuedMessage
        ? {
            queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
            queuedMessageIndex: inlineEditingQueuedMessage.queuedMessageIndex,
            ready: true,
            onComposerTargetChange: setInlineComposerTarget,
            onDismiss: dismissInlineQueuedMessageEditor,
          }
        : undefined,
    [dismissInlineQueuedMessageEditor, inlineEditingQueuedMessage],
  );

  return {
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
    updateInlineQueuedMessage,
    dismissInlineQueuedMessageEditor,
    beginEditQueuedMessage,
    inlineEditor,
    inlineComposerTarget,
    queuedMessagesByIdRef,
  };
}
