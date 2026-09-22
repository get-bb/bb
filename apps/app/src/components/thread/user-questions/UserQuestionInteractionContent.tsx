import { useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PendingInteractionUserQuestionQuestion } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { QuestionForm } from "@bb/shared-ui/question-form";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import { useStopThread } from "@/hooks/mutations/thread-runtime-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { invalidateThreadPendingInteractionResolutionQueries } from "@/hooks/cache-owners/mutation-cache-effects";
import { useStickyFooterAvailableHeight } from "./useStickyFooterAvailableHeight.js";

interface UserQuestionAnswerFormProps {
  interactionId: string;
  isResolving: boolean;
  questions: readonly PendingInteractionUserQuestionQuestion[];
  threadId: string;
}

export function UserQuestionAnswerForm({
  interactionId,
  isResolving,
  questions,
  threadId,
}: UserQuestionAnswerFormProps) {
  const normalizedQuestions = useMemo(
    () =>
      questions.map((question, index) => ({
        ...question,
        shortLabel: question.shortLabel ?? `Question ${index + 1}`,
        options: question.options ?? [],
      })),
    [questions],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const availableHeight = useStickyFooterAvailableHeight(rootRef);
  const queryClient = useQueryClient();
  const resolvePendingInteraction = useResolveThreadPendingInteraction();
  const stopThread = useStopThread();
  const disabled = resolvePendingInteraction.isPending || isResolving;
  const error = resolvePendingInteraction.error
    ? getMutationErrorMessage({
        error: resolvePendingInteraction.error,
        fallbackMessage: "Failed to submit answer",
        lifecycleOperation: "resolve_interaction",
      })
    : null;
  const refreshInteractionState = () => {
    resolvePendingInteraction.reset();
    invalidateThreadPendingInteractionResolutionQueries({
      queryClient,
      threadId,
    });
  };
  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-col"
      style={
        availableHeight === null ? undefined : { maxHeight: availableHeight }
      }
    >
      <QuestionForm
        key={interactionId}
        questions={normalizedQuestions}
        disabled={disabled}
        cancelDisabled={disabled || stopThread.isPending}
        onSubmit={(answers) => {
          void resolvePendingInteraction
            .mutateAsync({
              threadId,
              interactionId,
              resolution: { kind: "user_answer", answers },
            })
            .catch(() => {});
        }}
        onCancel={() => stopThread.mutate(threadId)}
      />
      {error ? (
        <div className="mt-2 shrink-0 rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive-text">
          <p>{error}</p>
          <p className="mt-1">
            This question may have expired or been resolved elsewhere. Refresh
            its state before trying again.
          </p>
          <Button
            className="mt-2"
            size="sm"
            type="button"
            variant="outline"
            onClick={refreshInteractionState}
          >
            Refresh question state
          </Button>
        </div>
      ) : null}
    </div>
  );
}
