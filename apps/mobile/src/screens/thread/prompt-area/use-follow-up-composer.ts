import {
  buildFollowUpSubmitMode,
  queuedInputToDraft,
  type FollowUpSubmitMode,
  type PromptDraftAttachment,
} from "@bb/client-core";
import type {
  ThreadQueuedMessage,
  ThreadTimelineModelFallback,
} from "@bb/domain";
import type { ThreadResponse, TimelineRow } from "@bb/server-contract";
import { randomUUID } from "expo-crypto";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ComposerHandle, ExecutionControlsProps } from "@/composer";
import {
  appendQuoteToComposerValue,
  composerValueFromDraftState,
  composerValueFromPromptInput,
  composerValueToPromptInput,
  type ComposerSubmitKind,
  type ComposerValue,
} from "@/composer/model";
import { useComposerDraft } from "@/data/composer";
import { useSystemConfig, useSystemProviders } from "@/data/system";
import { useThreadDefaultExecutionOptions } from "@/data/thread-detail";
import {
  useCreateThreadQueuedMessage,
  useEditMessagesExperimentEnabled,
  useEditThreadMessage,
  useSendThreadMessage,
  useSendThreadQueuedMessage,
  useStopThread,
  useUpdateThreadQueuedMessage,
} from "@/data/thread-runtime";
import { getMutationErrorMessage } from "@/lib/query/mutation-errors";
import { toast } from "@/ui";
import type { EditMessageRequest } from "../actions/message-actions-model";
import type { QueuedMessageEditRequest } from "../queue";
import {
  buildFollowUpSubmission,
  canEditSentMessages,
  followUpPlaceholder,
  followUpSubmissionErrorMessage,
  resolveFollowUpSubmitIntent,
  type FollowUpEditTarget,
} from "./follow-up-submission";
import { useThreadExecutionOptions } from "./use-thread-execution-options";

interface UseFollowUpComposerArgs {
  threadId: string;
  /**
   * The open thread; undefined while it loads. ThreadPromptArea mounts the
   * Composer only once it is defined, so nothing is typed into the draft
   * before its real scope (`projectId` + `threadId`) is known.
   */
  thread: ThreadResponse | undefined;
  hasPendingInteraction: boolean;
  pendingInteractionsInitialLoading: boolean;
  queuedMessages: readonly ThreadQueuedMessage[];
  modelFallback: ThreadTimelineModelFallback | null;
  activeWorkflowCount: number;
  activeBackgroundCommandCount: number;
  timelineRows: readonly TimelineRow[];
  timelineLoading: boolean;
  /** The environment is gone/destroyed: the composer is hidden (web parity). */
  environmentGone: boolean;
  /** Called once a submission was accepted (scroll the timeline to the end). */
  onSubmitted?: () => void;
  /** The mounted composer (focus after quote / edit). */
  composerRef: RefObject<ComposerHandle | null>;
}

export interface FollowUpComposerController {
  /** What the composer shows: the persisted thread draft, or the edit draft. */
  value: ComposerValue;
  attachments: PromptDraftAttachment[];
  setValue: (value: ComposerValue) => void;
  setAttachments: (attachments: PromptDraftAttachment[]) => void;
  submitMode: FollowUpSubmitMode;
  submitLabel: string;
  isSubmitting: boolean;
  placeholder: string;
  /** Archived thread / environment gone: no composer at all (web parity). */
  hidden: boolean;
  submit: (kind: ComposerSubmitKind) => Promise<void>;
  executionControls: ExecutionControlsProps | null;
  /** The thread shows "stopping" or a stop request is in flight. */
  isStopRequested: boolean;
  editing: FollowUpEditTarget | null;
  cancelEdit: () => void;
  /** Queued-message "Edit": load it into the composer. */
  beginQueuedMessageEdit: (request: QueuedMessageEditRequest) => void;
  /**
   * Sent-message "Edit message" (experiment); undefined when the thread,
   * provider, or runtime state rules editing out (hides the action).
   */
  editSentMessage: ((request: EditMessageRequest) => void) | undefined;
  /** "Add to chat" / "Quote paragraph": append a `> ` block to the draft. */
  quoteIntoComposer: (text: string) => void;
  /** The queued message whose edit is being saved (list shows a spinner). */
  savingQueuedMessageId: string | null;
  /** Queue list affordances while something is in flight. */
  queueSendDisabled: boolean;
  queueActionDisabled: boolean;
}

interface EditSession {
  target: FollowUpEditTarget;
  value: ComposerValue;
  attachments: PromptDraftAttachment[];
}

/**
 * The thread screen's follow-up composer state (port of the composer half of
 * apps/app ThreadDetailPromptArea + the sent-message edit session of
 * ThreadDetailView): the per-thread persisted draft, submit mode from
 * client-core, send / queue / steer through the runtime mutations with the
 * execution overrides, stop, queued-message and sent-message edit modes that
 * temporarily swap the draft, and "add to chat" quoting.
 */
export function useFollowUpComposer({
  threadId,
  thread,
  hasPendingInteraction,
  pendingInteractionsInitialLoading,
  queuedMessages,
  modelFallback,
  activeWorkflowCount,
  activeBackgroundCommandCount,
  timelineRows,
  timelineLoading,
  environmentGone,
  onSubmitted,
  composerRef,
}: UseFollowUpComposerArgs): FollowUpComposerController {
  // Placeholder scope only until the thread loads: the Composer is not
  // mounted before then (ThreadPromptArea) and the quote entry points sit in
  // the timeline / file previews that need the loaded thread, so nothing is
  // ever written under the placeholder key.
  const projectId = thread?.projectId ?? "";
  const draftScope = useMemo(
    () => ({ kind: "thread" as const, projectId, threadId }),
    [projectId, threadId],
  );
  const draft = useComposerDraft(draftScope);
  const [edit, setEdit] = useState<EditSession | null>(null);
  // Bumped when an edit session is dropped because its target vanished.
  const [staleEditNotice, setStaleEditNotice] = useState(0);

  const runtimeDisplayStatus = thread?.runtime.displayStatus ?? "idle";
  const archived = thread !== undefined && thread.archivedAt !== null;
  const hidden = archived || environmentGone;

  // --- Mutations ------------------------------------------------------------
  const sendMessage = useSendThreadMessage();
  const createQueued = useCreateThreadQueuedMessage();
  const sendQueued = useSendThreadQueuedMessage();
  const updateQueued = useUpdateThreadQueuedMessage();
  const editMessage = useEditThreadMessage();
  const stopThread = useStopThread();
  const isStopRequested =
    thread?.status === "stopping" ||
    (stopThread.isPending && stopThread.variables === threadId);
  const stop = useCallback(() => {
    stopThread.mutate(threadId);
  }, [stopThread, threadId]);

  // --- Execution options ------------------------------------------------------
  const defaultsQuery = useThreadDefaultExecutionOptions(threadId, {
    enabled: thread !== undefined && !hidden,
  });
  const execution = useThreadExecutionOptions({
    thread,
    defaultExecutionOptions: defaultsQuery.data,
    defaultExecutionOptionsError: defaultsQuery.isError,
    modelFallback,
    enabled: !hidden,
  });
  const isDefaultExecutionOptionsLoading =
    execution.defaultsState === "loading";

  // --- Submit mode ------------------------------------------------------------
  const baseSubmitMode = useMemo<FollowUpSubmitMode>(
    () =>
      buildFollowUpSubmitMode({
        hasPendingInteraction,
        isDefaultExecutionOptionsLoading,
        isPendingInteractionsInitialLoading: pendingInteractionsInitialLoading,
        isStopRequested,
        onStop: stop,
        runtimeDisplayStatus,
      }),
    [
      hasPendingInteraction,
      isDefaultExecutionOptionsLoading,
      isStopRequested,
      pendingInteractionsInitialLoading,
      runtimeDisplayStatus,
      stop,
    ],
  );
  const isFollowUpSubmitting =
    sendMessage.isPending || createQueued.isPending || sendQueued.isPending;
  const isEditSubmitting = updateQueued.isPending || editMessage.isPending;
  const systemConfig = useSystemConfig();
  const steerActiveThreadOnEnter =
    systemConfig.data?.generalSettings.steerActiveThreadOnEnter ?? false;

  // --- Sent-message edit eligibility --------------------------------------------
  const editExperiment = useEditMessagesExperimentEnabled();
  const providersQuery = useSystemProviders({ enabled: thread !== undefined });
  const providerSupportsSessionRewind =
    providersQuery.data?.find((provider) => provider.id === thread?.providerId)
      ?.capabilities.supportsSessionRewind ?? false;
  const canEditSent =
    thread !== undefined &&
    !hidden &&
    canEditSentMessages({
      editMessagesExperiment: editExperiment,
      providerSupportsSessionRewind,
      archived,
      hasPendingInteraction,
      isEditing: edit !== null,
      isSubmitting: isFollowUpSubmitting || isEditSubmitting,
      timelineEmptyAndLoading: timelineLoading && timelineRows.length === 0,
      queuedMessageCount: queuedMessages.length,
      activeWorkflowCount,
      activeBackgroundAgentCount: thread.activeBackgroundAgentCount,
      activeBackgroundCommandCount,
    });

  // --- Edit sessions ------------------------------------------------------------
  const beginQueuedMessageEdit = useCallback(
    ({ queuedMessage }: QueuedMessageEditRequest) => {
      const seeded = composerValueFromDraftState(
        queuedInputToDraft(queuedMessage.content),
      );
      setEdit({
        target: {
          kind: "queued-message",
          queuedMessageId: queuedMessage.id,
          expectedUpdatedAt: queuedMessage.updatedAt,
        },
        value: seeded.value,
        attachments: seeded.attachments,
      });
      composerRef.current?.focus();
    },
    [composerRef],
  );
  const beginSentMessageEdit = useCallback(
    (request: EditMessageRequest) => {
      const seeded = composerValueFromPromptInput(request.input);
      setEdit({
        target: {
          kind: "sent-message",
          rowId: request.rowId,
          operationId: randomUUID(),
          expectedRequestSequence: request.expectedRequestSequence,
        },
        value: seeded.value,
        attachments: seeded.attachments,
      });
      composerRef.current?.focus();
    },
    [composerRef],
  );
  const cancelEdit = useCallback(() => setEdit(null), []);

  // The edited queued message left the queue (sent / deleted elsewhere) or
  // the edited sent message vanished from the timeline: drop the session.
  const editTarget = edit?.target ?? null;
  const editTargetGone =
    editTarget !== null &&
    (editTarget.kind === "queued-message"
      ? !queuedMessages.some(
          (message) => message.id === editTarget.queuedMessageId,
        )
      : !timelineLoading &&
        !timelineRows.some((row) => row.id === editTarget.rowId));
  if (editTargetGone) {
    // Adjust state during render (React's "reset state on prop change"
    // pattern) so the stale draft never reaches the composer.
    setEdit(null);
    setStaleEditNotice((count) => count + 1);
  }
  useEffect(() => {
    if (staleEditNotice === 0) return;
    toast.warning("The message being edited is no longer available.");
  }, [staleEditNotice]);

  // --- Draft accessors (edit session wins) --------------------------------------
  const value = edit ? edit.value : draft.value;
  const attachments = edit ? edit.attachments : draft.attachments;
  const setValue = useCallback(
    (next: ComposerValue) => {
      setEdit((current) => (current ? { ...current, value: next } : current));
      if (!edit) draft.setValue(next);
    },
    [draft, edit],
  );
  const setAttachments = useCallback(
    (next: PromptDraftAttachment[]) => {
      setEdit((current) =>
        current ? { ...current, attachments: next } : current,
      );
      if (!edit) draft.setAttachments(next);
    },
    [draft, edit],
  );
  const quoteIntoComposer = useCallback(
    (text: string) => {
      if (edit) {
        setEdit((current) =>
          current
            ? {
                ...current,
                value: appendQuoteToComposerValue(current.value, text),
              }
            : current,
        );
      } else {
        draft.setValue(appendQuoteToComposerValue(draft.value, text));
      }
      composerRef.current?.focus();
    },
    [composerRef, draft, edit],
  );

  // --- Submit ---------------------------------------------------------------------
  const input = useMemo(
    () => composerValueToPromptInput(value, attachments),
    [attachments, value],
  );
  // Latest draft for the failure path: the callback below clears the draft
  // before the request and must compare against what the user typed since.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const submitEdit = useCallback(async () => {
    if (!edit || input.length === 0) return;
    const target = edit.target;
    try {
      if (target.kind === "queued-message") {
        await updateQueued.mutateAsync({
          id: threadId,
          queuedMessageId: target.queuedMessageId,
          expectedUpdatedAt: target.expectedUpdatedAt,
          input,
        });
      } else {
        const selection = execution.selection;
        await editMessage.mutateAsync({
          id: threadId,
          operationId: target.operationId,
          expectedRequestSequence: target.expectedRequestSequence,
          input,
          ...(selection
            ? {
                model: selection.model,
                permissionMode: selection.permissionMode,
                reasoningLevel: selection.reasoningLevel,
                executionInputSources: selection.executionInputSources,
                ...(selection.supportsServiceTier && selection.serviceTier
                  ? { serviceTier: selection.serviceTier }
                  : {}),
              }
            : {}),
        });
      }
      setEdit(null);
      onSubmitted?.();
    } catch (error) {
      toast.error(
        getMutationErrorMessage({
          error,
          fallbackMessage:
            target.kind === "queued-message"
              ? "Failed to update queued message"
              : "Failed to edit the message",
        }),
      );
    }
  }, [
    edit,
    editMessage,
    execution.selection,
    input,
    onSubmitted,
    threadId,
    updateQueued,
  ]);

  const submitFollowUp = useCallback(
    async (kind: ComposerSubmitKind) => {
      const intent = resolveFollowUpSubmitIntent({
        kind,
        steerActiveThreadOnEnter,
      });
      const submission = buildFollowUpSubmission({
        intent,
        runtimeDisplayStatus,
        threadId,
        input,
        execution: execution.selection,
        queuedMessages,
      });
      if (!submission) return;
      if (submission.kind === "send" && isDefaultExecutionOptionsLoading) {
        return;
      }
      const submittedValue = draft.value;
      const submittedAttachments = draft.attachments;
      if (submission.kind !== "send-queued-head") draft.clear();
      try {
        switch (submission.kind) {
          case "send":
          case "steer":
            await sendMessage.mutateAsync(submission.request);
            break;
          case "queue":
            await createQueued.mutateAsync(submission.request);
            break;
          case "send-queued-head":
            await sendQueued.mutateAsync({
              id: submission.request.id,
              queuedMessageId: submission.request.queuedMessageId,
              mode: submission.request.mode,
            });
            break;
        }
        onSubmitted?.();
      } catch (error) {
        // Restore the draft unless the user already typed something new.
        const current = draftRef.current;
        if (
          submission.kind !== "send-queued-head" &&
          current.value.text.length === 0 &&
          current.attachments.length === 0
        ) {
          current.replace(submittedValue, submittedAttachments);
        }
        toast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: followUpSubmissionErrorMessage(submission.kind),
          }),
        );
      }
    },
    [
      createQueued,
      draft,
      execution.selection,
      input,
      isDefaultExecutionOptionsLoading,
      onSubmitted,
      queuedMessages,
      runtimeDisplayStatus,
      sendMessage,
      sendQueued,
      steerActiveThreadOnEnter,
      threadId,
    ],
  );

  const submit = useCallback(
    (kind: ComposerSubmitKind) => (edit ? submitEdit() : submitFollowUp(kind)),
    [edit, submitEdit, submitFollowUp],
  );

  // An edit submits through its own path: the queued editor is always
  // "ready" (web parity); a sent-message edit needs a quiet, ready thread.
  const submitMode = useMemo<FollowUpSubmitMode>(() => {
    if (!edit) return baseSubmitMode;
    if (edit.target.kind === "queued-message") return { kind: "ready" };
    if (
      canEditSent ||
      (baseSubmitMode.kind === "ready" &&
        !isEditSubmitting &&
        input.length === 0)
    ) {
      return { kind: "ready" };
    }
    return baseSubmitMode.kind === "blocked"
      ? baseSubmitMode
      : { kind: "blocked", reason: "unavailable" };
  }, [baseSubmitMode, canEditSent, edit, input.length, isEditSubmitting]);

  const placeholder = followUpPlaceholder({
    runtimeDisplayStatus,
    isStopRequested,
    editing: editTarget,
  });
  const queueMutationPending =
    createQueued.isPending || sendQueued.isPending || updateQueued.isPending;

  return {
    value,
    attachments,
    setValue,
    setAttachments,
    submitMode,
    submitLabel: edit ? "Save" : "Send",
    isSubmitting: edit ? isEditSubmitting : isFollowUpSubmitting,
    placeholder,
    hidden,
    submit,
    executionControls: execution.controls,
    isStopRequested,
    editing: editTarget,
    cancelEdit,
    beginQueuedMessageEdit,
    editSentMessage: canEditSent ? beginSentMessageEdit : undefined,
    quoteIntoComposer,
    savingQueuedMessageId: updateQueued.isPending
      ? (updateQueued.variables?.queuedMessageId ?? null)
      : null,
    queueSendDisabled:
      !(baseSubmitMode.kind === "ready" || baseSubmitMode.kind === "queue") ||
      runtimeDisplayStatus === "provisioning" ||
      runtimeDisplayStatus === "starting" ||
      runtimeDisplayStatus === "waiting-for-host" ||
      isFollowUpSubmitting ||
      queueMutationPending,
    queueActionDisabled: queueMutationPending,
  };
}
