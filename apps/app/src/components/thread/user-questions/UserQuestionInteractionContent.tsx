import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  PendingInteractionUserQuestionOption,
  PendingInteractionUserQuestionQuestion,
} from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { TabPill } from "@/components/ui/tab-pill.js";
import { useAutoGrow } from "@/hooks/useAutoGrow";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import { useStopThread } from "@/hooks/mutations/thread-runtime-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { cn } from "@/lib/utils";
import {
  answerStateFor,
  buildUserAnswerResolution,
  createInitialFormState,
  isQuestionAnswered,
  type QuestionAnswerState,
  type QuestionFormState,
} from "./user-question-form-state.js";

interface UserQuestionAnswerFormProps {
  className?: string;
  interactionId: string;
  /**
   * The interaction has reached `status: "resolving"` — the server is in the
   * middle of delivering the answer to the provider. Keeps the form chrome on
   * screen with everything disabled and a spinner in the submit button.
   */
  isResolving?: boolean;
  questions: readonly PendingInteractionUserQuestionQuestion[];
  threadId: string;
}

interface QuestionOptionRowProps {
  checked: boolean;
  label: string;
  description?: string;
  multiSelect: boolean;
  onSelect: () => void;
}

interface QuestionTabsProps {
  currentIndex: number;
  formState: QuestionFormState;
  onSelect: (index: number) => void;
  questions: readonly PendingInteractionUserQuestionQuestion[];
}

interface QuestionInputBlockProps {
  disabled: boolean;
  question: PendingInteractionUserQuestionQuestion;
  state: QuestionAnswerState;
  onToggleOption: (optionValue: string) => void;
  onSelectOther: () => void;
  onFreeTextChange: (value: string) => void;
  /** Cmd/Ctrl+Enter in the free-text box advances/submits (see handleAdvance). */
  onShortcutSubmit: () => void;
}

const OTHER_OPTION_LABEL = "Other…";
const USER_QUESTION_FREE_TEXT_MIN_HEIGHT = 84;
const USER_QUESTION_FREE_TEXT_MAX_HEIGHT = 158;

function QuestionOptionRow({
  checked,
  label,
  description,
  multiSelect,
  onSelect,
}: QuestionOptionRowProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
        checked ? "bg-surface-selected" : "hover:bg-state-hover",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
          multiSelect ? "rounded" : "rounded-full",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input",
        )}
      >
        {checked ? <Icon name="Check" className="size-3" aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function QuestionTabs({
  currentIndex,
  formState,
  onSelect,
  questions,
}: QuestionTabsProps) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {/* A plain button group, not an ARIA tablist: these toggle which question
          is shown but aren't tab/tabpanel widgets, so role="tablist" would be
          malformed without role="tab" children + panels. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {questions.map((question, index) => {
          const answered = isQuestionAnswered(
            question,
            answerStateFor(formState, question),
          );
          return (
            <TabPill
              key={question.id}
              label={question.shortLabel ?? `Question ${index + 1}`}
              leadingVisual={
                <Icon name="FileQuestion" className="size-3.5" aria-hidden />
              }
              labelClassName={answered ? "line-through" : undefined}
              title={question.prompt}
              isActive={index === currentIndex}
              onSelect={() => onSelect(index)}
              closeAction={null}
            />
          );
        })}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {currentIndex + 1} of {questions.length}
      </span>
    </div>
  );
}

function QuestionInputBlock({
  disabled,
  question,
  state,
  onToggleOption,
  onSelectOther,
  onFreeTextChange,
  onShortcutSubmit,
}: QuestionInputBlockProps) {
  const freeTextRef = useRef<HTMLTextAreaElement>(null);
  const resizeFreeTextArea = useAutoGrow(freeTextRef, {
    minHeight: USER_QUESTION_FREE_TEXT_MIN_HEIGHT,
    maxHeight: USER_QUESTION_FREE_TEXT_MAX_HEIGHT,
  });
  const options = question.options ?? [];
  const freeTextLabel = `${question.shortLabel ?? question.prompt} answer`;

  useLayoutEffect(() => {
    if (!state.otherSelected) return;
    resizeFreeTextArea();
  }, [
    question.id,
    resizeFreeTextArea,
    state.otherSelected,
    state.otherText,
  ]);

  const handleFreeTextKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    // Cmd/Ctrl+Enter submits/advances, but never mid-IME-composition (e.g.
    // selecting a Japanese candidate with Enter must not submit).
    if (
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      (!event.metaKey && !event.ctrlKey)
    ) {
      return;
    }
    event.preventDefault();
    onShortcutSubmit();
  };
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{question.prompt}</legend>
      <div className="text-sm font-semibold text-foreground">
        {question.prompt}
      </div>
      <div className="mt-2 space-y-0.5">
        {options.map((option: PendingInteractionUserQuestionOption) => (
          <QuestionOptionRow
            key={option.value}
            checked={state.selected.includes(option.value)}
            label={option.label}
            description={option.description}
            multiSelect={question.multiSelect}
            onSelect={() => onToggleOption(option.value)}
          />
        ))}
        {question.allowFreeText && options.length > 0 ? (
          <QuestionOptionRow
            checked={state.otherSelected}
            label={OTHER_OPTION_LABEL}
            multiSelect={question.multiSelect}
            onSelect={onSelectOther}
          />
        ) : null}
      </div>
      {state.otherSelected ? (
        <textarea
          ref={freeTextRef}
          aria-label={freeTextLabel}
          value={state.otherText}
          rows={1}
          autoFocus
          autoComplete="off"
          onChange={(event) => {
            onFreeTextChange(event.target.value);
            resizeFreeTextArea(event.target);
          }}
          onKeyDown={handleFreeTextKeyDown}
          placeholder="Type your own answer…"
          className="mt-2 w-full resize-none overflow-y-auto rounded-md border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          style={{
            minHeight: `${USER_QUESTION_FREE_TEXT_MIN_HEIGHT}px`,
            maxHeight: `${USER_QUESTION_FREE_TEXT_MAX_HEIGHT}px`,
          }}
        />
      ) : null}
    </fieldset>
  );
}

export function UserQuestionAnswerForm({
  className,
  interactionId,
  isResolving = false,
  questions,
  threadId,
}: UserQuestionAnswerFormProps) {
  const [formState, setFormState] = useState<QuestionFormState>(() =>
    createInitialFormState(questions),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeInteractionId, setActiveInteractionId] = useState(interactionId);
  const resolvePendingInteraction = useResolveThreadPendingInteraction();
  const stopThread = useStopThread();

  // Reset the form only when a different interaction takes over. Keyed on the
  // stable interaction id rather than the `questions` array, whose reference
  // churns on background refetch/poll — depending on it would wipe in-progress
  // answers. React's "adjust state during render" pattern always reads the
  // current `questions`, so no effect (or stale closure) is needed.
  if (activeInteractionId !== interactionId) {
    setActiveInteractionId(interactionId);
    setFormState(createInitialFormState(questions));
    setCurrentIndex(0);
  }

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex] ?? null;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalQuestions - 1;
  const allAnswered = useMemo(
    () =>
      totalQuestions > 0 &&
      questions.every((question) =>
        isQuestionAnswered(question, answerStateFor(formState, question)),
      ),
    [formState, questions, totalQuestions],
  );

  const mutationErrorMessage = resolvePendingInteraction.error
    ? getMutationErrorMessage({
        error: resolvePendingInteraction.error,
        fallbackMessage: "Failed to submit answer",
        lifecycleOperation: "resolve_interaction",
      })
    : null;
  const disabled = resolvePendingInteraction.isPending || isResolving;

  const updateQuestionState = (
    question: PendingInteractionUserQuestionQuestion,
    update: (state: QuestionAnswerState) => QuestionAnswerState,
  ): void => {
    setFormState((current) => ({
      ...current,
      [question.id]: update(answerStateFor(current, question)),
    }));
  };

  const handleToggleOption = (
    question: PendingInteractionUserQuestionQuestion,
    optionValue: string,
  ): void => {
    updateQuestionState(question, (state) => {
      if (question.multiSelect) {
        const selected = state.selected.includes(optionValue)
          ? state.selected.filter((value) => value !== optionValue)
          : [...state.selected, optionValue];
        return { ...state, selected };
      }
      return { ...state, selected: [optionValue], otherSelected: false };
    });
  };

  const handleSelectOther = (
    question: PendingInteractionUserQuestionQuestion,
  ): void => {
    updateQuestionState(question, (state) =>
      question.multiSelect
        ? { ...state, otherSelected: !state.otherSelected }
        : { ...state, selected: [], otherSelected: true },
    );
  };

  const handleFreeTextChange = (
    question: PendingInteractionUserQuestionQuestion,
    value: string,
  ): void => {
    updateQuestionState(question, (state) => ({ ...state, otherText: value }));
  };

  const submitAnswer = (): void => {
    if (disabled || !allAnswered) {
      return;
    }
    void resolvePendingInteraction
      .mutateAsync({
        threadId,
        interactionId,
        resolution: buildUserAnswerResolution(questions, formState),
      })
      .catch(() => {});
  };

  const handleAdvance = (): void => {
    if (isLast) {
      submitAnswer();
      return;
    }
    setCurrentIndex((index) => Math.min(index + 1, totalQuestions - 1));
  };

  const handleCancel = (): void => {
    stopThread.mutate(threadId);
  };

  if (!currentQuestion) {
    return null;
  }

  const currentState = answerStateFor(formState, currentQuestion);

  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      {totalQuestions > 1 ? (
        <QuestionTabs
          currentIndex={currentIndex}
          formState={formState}
          onSelect={setCurrentIndex}
          questions={questions}
        />
      ) : null}
      <QuestionInputBlock
        disabled={disabled}
        question={currentQuestion}
        state={currentState}
        onToggleOption={(optionValue) =>
          handleToggleOption(currentQuestion, optionValue)
        }
        onSelectOther={() => handleSelectOther(currentQuestion)}
        onFreeTextChange={(value) => handleFreeTextChange(currentQuestion, value)}
        onShortcutSubmit={handleAdvance}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || stopThread.isPending}
          onClick={handleCancel}
        >
          Cancel
        </Button>
        <div className="flex items-center gap-2">
          {!isFirst ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
            >
              Back
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={disabled || (isLast && !allAnswered)}
            onClick={handleAdvance}
          >
            {isResolving ? (
              <Icon name="Spinner" className="size-3 animate-spin" />
            ) : null}
            {isLast ? "Submit answer" : "Next"}
          </Button>
        </div>
      </div>
      {mutationErrorMessage ? (
        <div className="mt-2 rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive-text">
          {mutationErrorMessage}
        </div>
      ) : null}
    </div>
  );
}
