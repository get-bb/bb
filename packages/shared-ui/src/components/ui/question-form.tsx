import type {
  Question,
  QuestionOption,
  QuestionAnswer,
} from "./question-form-state";
import {
  useQuestionFormHost,
  type QuestionFormAction,
  type QuestionFormHost,
  type QuestionShortcut,
} from "./question-form-host";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Button } from "./button";
import { Icon } from "./icon";
import { OverflowFade } from "./overflow-fade";
import { VoiceInputTextarea } from "./voice-input-textarea";
import { usePointerCoarse } from "./hooks/use-pointer-coarse";
import { cn } from "../../lib/utils";
import {
  answerStateFor,
  areRequiredQuestionsAnswered,
  buildQuestionAnswers,
  isQuestionAnswered,
  resolveQuestionShortcutChoice,
  type QuestionAnswerState,
  type QuestionFormState,
} from "./question-form-state";
import { useQuestionFormDraft } from "./question-form-draft";

const OTHER_OPTION_LABEL = "Other…";
const FREE_TEXT_MIN_HEIGHT = 84;
const FREE_TEXT_MAX_HEIGHT = 158;
const PREVIEW_MAX_HEIGHT = 220;
const TAB_EDGE_EPSILON_PX = 1;
const TAB_FADE_WIDTH_PX = 24;

interface QuestionOptionRowProps {
  checked: boolean;
  density: QuestionFormHost["density"];
  label: string;
  description?: string;
  multiSelect: boolean;
  onSelect: () => void;
  shortcut?: QuestionShortcut;
}

function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  { minHeight, maxHeight }: { minHeight: number; maxHeight: number },
) {
  return useCallback(
    (textarea?: HTMLTextAreaElement | null) => {
      const element = textarea ?? ref.current;
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(
        Math.max(element.scrollHeight, minHeight),
        maxHeight,
      )}px`;
    },
    [maxHeight, minHeight, ref],
  );
}

function QuestionOptionRow({
  checked,
  density,
  label,
  description,
  multiSelect,
  onSelect,
  shortcut,
}: QuestionOptionRowProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
        checked ? "bg-surface-selected" : "hover:bg-state-hover",
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center border",
          multiSelect ? "rounded" : "rounded-full",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input",
        )}
      >
        {checked ? <Icon name="Check" className="size-3" aria-hidden /> : null}
      </span>
      {density === "compact" ? (
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 break-words text-xs text-foreground">
            {label}
          </span>
          {description ? (
            <span
              title={description}
              className="min-w-0 grow basis-24 truncate text-xs text-muted-foreground"
            >
              {description}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-foreground">{label}</span>
          {description ? (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      )}
      {shortcut ? (
        <kbd
          aria-hidden="true"
          className="shrink-0 text-xs font-normal text-subtle-foreground"
        >
          {shortcut.label}
        </kbd>
      ) : null}
    </button>
  );
}

function QuestionOptionPreview({ preview }: { preview: string }) {
  return (
    <pre
      className="mx-2.5 mb-1 mt-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-raised px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground"
      style={{ maxHeight: `${PREVIEW_MAX_HEIGHT}px` }}
    >
      {preview}
    </pre>
  );
}

interface QuestionTabsProps {
  disabled: boolean;
  currentIndex: number;
  formState: QuestionFormState;
  onSelect: (index: number) => void;
  questions: readonly Question[];
}

interface TabOverflow {
  start: boolean;
  end: boolean;
}

function QuestionTabs({
  disabled,
  currentIndex,
  formState,
  onSelect,
  questions,
}: QuestionTabsProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [overflow, setOverflow] = useState<TabOverflow>({
    start: false,
    end: false,
  });

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
    const start = viewport.scrollLeft > TAB_EDGE_EPSILON_PX;
    const end = viewport.scrollLeft < maxScrollLeft - TAB_EDGE_EPSILON_PX;
    setOverflow((previous) =>
      previous.start === start && previous.end === end
        ? previous
        : { start, end },
    );
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const tab = tabRefs.current[currentIndex];
    if (viewport && tab) {
      const tabStart = tab.offsetLeft - TAB_FADE_WIDTH_PX;
      const tabEnd = tab.offsetLeft + tab.offsetWidth + TAB_FADE_WIDTH_PX;
      if (tabStart < viewport.scrollLeft) {
        viewport.scrollLeft = Math.max(0, tabStart);
      } else if (tabEnd > viewport.scrollLeft + viewport.clientWidth) {
        viewport.scrollLeft = tabEnd - viewport.clientWidth;
      }
    }
    measure();
  }, [currentIndex, measure, questions.length]);

  return (
    <div className="mb-2 flex shrink-0 items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <OverflowFade
          placement="left"
          tone="surface-recessed"
          className={cn("z-10", overflow.start ? "opacity-100" : "opacity-0")}
        />
        <OverflowFade
          placement="right"
          tone="surface-recessed"
          className={cn("z-10", overflow.end ? "opacity-100" : "opacity-0")}
        />
        <div
          ref={viewportRef}
          onScroll={measure}
          data-question-tabs
          className="relative flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {questions.map((question, index) => {
            const answered = isQuestionAnswered(
              question,
              answerStateFor(formState, question),
            );
            const isActive = index === currentIndex;
            return (
              <div
                key={question.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                className={cn(
                  "relative inline-flex h-7 shrink-0 items-center rounded-md",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-state-hover",
                )}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(index)}
                  aria-pressed={isActive}
                  title={question.prompt}
                  className="flex h-full min-w-0 items-center rounded-md px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "truncate text-xs",
                      answered ? "line-through" : undefined,
                    )}
                    style={{ maxWidth: "180px" }}
                  >
                    {question.shortLabel}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {currentIndex + 1} of {questions.length}
      </span>
    </div>
  );
}

interface QuestionInputBlockProps {
  density: QuestionFormHost["density"];
  showPrompt: boolean;
  disabled: boolean;
  question: Question;
  state: QuestionAnswerState;
  onToggleOption: (optionValue: string) => void;
  onSelectOther: () => void;
  onFreeTextChange: (value: string) => void;
  onFreeTextSubmit: () => void;
  onVoiceInputActiveChange: (active: boolean) => void;
  shortcuts: ReadonlyMap<string, QuestionShortcut>;
}

function QuestionInputBlock({
  density,
  showPrompt,
  disabled,
  question,
  state,
  onToggleOption,
  onSelectOther,
  onFreeTextChange,
  onFreeTextSubmit,
  onVoiceInputActiveChange,
  shortcuts,
}: QuestionInputBlockProps) {
  const freeTextRef = useRef<HTMLTextAreaElement>(null);
  const isPointerCoarse = usePointerCoarse();
  const resizeFreeTextArea = useAutoGrow(freeTextRef, {
    minHeight: FREE_TEXT_MIN_HEIGHT,
    maxHeight: FREE_TEXT_MAX_HEIGHT,
  });
  const options = question.options;
  const freeTextLabel = `${question.shortLabel} answer`;

  useLayoutEffect(() => {
    if (!state.otherSelected) return;
    resizeFreeTextArea();
  }, [question.id, resizeFreeTextArea, state.otherSelected, state.otherText]);

  const handleFreeTextKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (
      isPointerCoarse ||
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onFreeTextSubmit();
  };

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{question.prompt}</legend>
      {showPrompt && question.prompt ? (
        <div className="text-xs font-medium text-foreground">
          {question.prompt}
        </div>
      ) : null}
      {question.required ? null : (
        <div className="text-xs text-muted-foreground">Optional</div>
      )}
      <div
        className={cn(
          "space-y-0.5",
          showPrompt || !question.required ? "mt-1" : undefined,
        )}
      >
        {options.map((option: QuestionOption, index) => {
          const checked = state.selected.includes(option.value);
          return (
            <div key={option.value}>
              <QuestionOptionRow
                checked={checked}
                density={density}
                label={option.label}
                description={option.description}
                multiSelect={question.multiSelect}
                onSelect={() => onToggleOption(option.value)}
                shortcut={shortcuts.get(String(index))}
              />
              {checked && option.preview ? (
                <QuestionOptionPreview preview={option.preview} />
              ) : null}
            </div>
          );
        })}
        {question.allowFreeText && options.length > 0 ? (
          <QuestionOptionRow
            checked={state.otherSelected}
            density={density}
            label={OTHER_OPTION_LABEL}
            multiSelect={question.multiSelect}
            onSelect={onSelectOther}
            shortcut={shortcuts.get(String(options.length))}
          />
        ) : null}
      </div>
      {state.otherSelected ? (
        <VoiceInputTextarea
          ref={freeTextRef}
          aria-label={freeTextLabel}
          value={state.otherText}
          rows={1}
          autoFocus={!isPointerCoarse}
          autoComplete="off"
          onValueChange={onFreeTextChange}
          onVoiceInputActiveChange={onVoiceInputActiveChange}
          onKeyDown={handleFreeTextKeyDown}
          placeholder="Type your own answer…"
          className="mt-2 block w-full resize-none overflow-y-auto rounded-md border border-border bg-surface-raised px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          style={{
            minHeight: `${FREE_TEXT_MIN_HEIGHT}px`,
            maxHeight: `${FREE_TEXT_MAX_HEIGHT}px`,
          }}
        />
      ) : null}
    </fieldset>
  );
}

export interface QuestionFormProps {
  draftKey?: string;
  questions: readonly Question[];
  disabled: boolean;
  cancelDisabled: boolean;
  onSubmit: (answers: Record<string, QuestionAnswer>) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

export function QuestionForm({
  draftKey,
  questions,
  disabled: inputDisabled,
  cancelDisabled,
  onSubmit,
  onCancel,
}: QuestionFormProps) {
  const { formState, setFormState, currentIndex, setCurrentIndex, clearDraft } =
    useQuestionFormDraft(draftKey, questions);
  const [settledAction, setSettledAction] = useState<
    "submit" | "cancel" | null
  >(null);
  const disabled = inputDisabled || settledAction !== null;
  const [voiceBusy, setVoiceBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const {
    density,
    promptShownAbove,
    closeInline,
    shortcuts,
    actionShortcuts,
    registerChoiceHandler,
    registerActionHandler,
  } = useQuestionFormHost();

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex] ?? null;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalQuestions - 1;
  const canSubmit = useMemo(
    () => areRequiredQuestionsAnswered(questions, formState),
    [formState, questions],
  );
  const navigationDisabled = disabled || voiceBusy;
  const cancelBlocked =
    closeInline === null && (cancelDisabled || settledAction !== null);

  const updateQuestionState = useCallback(
    (
      question: Question,
      update: (state: QuestionAnswerState) => QuestionAnswerState,
    ): void => {
      setFormState((current) => ({
        ...current,
        [question.id]: update(answerStateFor(current, question)),
      }));
    },
    [setFormState],
  );

  const handleToggleOption = useCallback(
    (question: Question, optionValue: string): void => {
      updateQuestionState(question, (state) => {
        if (question.multiSelect) {
          const selected = state.selected.includes(optionValue)
            ? state.selected.filter((value) => value !== optionValue)
            : [...state.selected, optionValue];
          return { ...state, selected };
        }
        return { ...state, selected: [optionValue], otherSelected: false };
      });
    },
    [updateQuestionState],
  );

  const handleSelectOther = useCallback(
    (question: Question): void => {
      updateQuestionState(question, (state) =>
        question.multiSelect
          ? { ...state, otherSelected: !state.otherSelected }
          : { ...state, selected: [], otherSelected: true },
      );
    },
    [updateQuestionState],
  );

  const handleFreeTextChange = (question: Question, value: string): void => {
    updateQuestionState(question, (state) => ({ ...state, otherText: value }));
  };

  const submitAnswer = async (): Promise<void> => {
    if (disabled || voiceBusy || !canSubmit) return;
    try {
      await onSubmit(buildQuestionAnswers(questions, formState));
      setSettledAction("submit");
      clearDraft();
    } catch {}
  };

  const handleAdvance = (): void => {
    if (navigationDisabled) return;
    if (isLast) {
      void submitAnswer();
      return;
    }
    setCurrentIndex((index) => Math.min(index + 1, totalQuestions - 1));
  };

  const handleBack = (): void => {
    setCurrentIndex((index) => Math.max(index - 1, 0));
  };

  const handleCancel = async (): Promise<void> => {
    if (closeInline) {
      closeInline();
      return;
    }
    try {
      await onCancel();
      setSettledAction("cancel");
      clearDraft();
    } catch {}
  };

  const runAction = (action: QuestionFormAction): boolean => {
    if (action === "cancel") {
      if (cancelBlocked) return false;
      void handleCancel();
      return true;
    }
    if (navigationDisabled) return false;
    if (action === "submit") {
      if (isLast && !canSubmit) return false;
      handleAdvance();
    } else if (action === "previous") {
      if (isFirst) return false;
      handleBack();
    } else {
      if (isLast) return false;
      setCurrentIndex(currentIndex + 1);
    }
    formRef.current?.focus();
    return true;
  };
  const runActionRef = useRef(runAction);
  useLayoutEffect(() => {
    runActionRef.current = runAction;
  });

  useEffect(
    () => registerActionHandler((action) => runActionRef.current(action)),
    [registerActionHandler],
  );

  useEffect(() => {
    if (disabled || voiceBusy || currentQuestion === null) return;
    return registerChoiceHandler((index) => {
      const choice = resolveQuestionShortcutChoice(currentQuestion, index);
      if (!choice) return false;
      if (choice.kind === "option") {
        handleToggleOption(currentQuestion, choice.value);
        formRef.current?.focus();
      } else handleSelectOther(currentQuestion);
      return true;
    });
  }, [
    disabled,
    voiceBusy,
    currentQuestion,
    registerChoiceHandler,
    handleToggleOption,
    handleSelectOther,
  ]);

  if (!currentQuestion) return null;

  const currentState = answerStateFor(formState, currentQuestion);
  const compactButtonClass = density === "compact" ? "font-normal" : undefined;

  return (
    <div
      ref={formRef}
      tabIndex={-1}
      data-question-form
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.key !== "Enter" ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          disabled
        )
          return;
        event.preventDefault();
        handleAdvance();
      }}
      className="-m-1 flex min-h-0 flex-col rounded-md p-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {totalQuestions > 1 ? (
        <QuestionTabs
          disabled={navigationDisabled}
          currentIndex={currentIndex}
          formState={formState}
          onSelect={setCurrentIndex}
          questions={questions}
        />
      ) : null}
      <div>
        <QuestionInputBlock
          key={currentQuestion.id}
          density={density}
          showPrompt={
            density !== "compact" ||
            totalQuestions > 1 ||
            currentQuestion.prompt !== promptShownAbove
          }
          disabled={disabled}
          question={currentQuestion}
          state={currentState}
          onToggleOption={(optionValue) =>
            handleToggleOption(currentQuestion, optionValue)
          }
          onSelectOther={() => handleSelectOther(currentQuestion)}
          onFreeTextChange={(value) =>
            handleFreeTextChange(currentQuestion, value)
          }
          onVoiceInputActiveChange={setVoiceBusy}
          onFreeTextSubmit={() => runAction("submit")}
          shortcuts={shortcuts}
        />
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2",
          density === "compact" ? "mt-1.5" : "mt-3",
        )}
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={compactButtonClass}
          aria-keyshortcuts={actionShortcuts.get("cancel")?.ariaKeyshortcuts}
          disabled={cancelBlocked}
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
              className={compactButtonClass}
              aria-keyshortcuts={
                actionShortcuts.get("previous")?.ariaKeyshortcuts
              }
              disabled={navigationDisabled}
              onClick={handleBack}
            >
              Back
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className={compactButtonClass}
            aria-keyshortcuts={actionShortcuts.get("submit")?.ariaKeyshortcuts}
            disabled={navigationDisabled || (isLast && !canSubmit)}
            onClick={handleAdvance}
          >
            {inputDisabled || settledAction === "submit" ? (
              <Icon name="Spinner" className="size-3 animate-spin" />
            ) : null}
            {isLast
              ? density === "compact"
                ? "Submit"
                : "Submit answer"
              : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
