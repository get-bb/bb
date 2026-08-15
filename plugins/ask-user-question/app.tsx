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
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  interactionPayloadSchema,
  type InteractionOption,
  type InteractionQuestion,
} from "./src/contracts.js";
import {
  answerStateFor,
  buildInteractionResponse,
  createInitialFormState,
  isQuestionAnswered,
  resolveQuestionShortcutChoice,
  type QuestionAnswerState,
  type QuestionFormState,
} from "./src/form-state.js";

// Ported from BB's native user-question form
// (apps/app/src/components/thread/user-questions/UserQuestionInteractionContent.tsx)
// so the cross-provider tool looks and behaves identically to the Claude Code
// one. Differences are only where the plugin surface differs: submit/cancel
// arrive as props instead of mutations, the number-key shortcuts are bound
// locally instead of through the app command registry, and option previews are
// rendered (the native form does not surface them yet).

const OTHER_OPTION_LABEL = "Other…";
const FREE_TEXT_MIN_HEIGHT = 84;
const FREE_TEXT_MAX_HEIGHT = 158;
const PREVIEW_MAX_HEIGHT = 220;
/** Matches BB's default `question.select.N` bindings: plain digits, 1-based. */
const MAX_SHORTCUT_ROWS = 9;

interface QuestionOptionRowProps {
  checked: boolean;
  label: string;
  description?: string;
  multiSelect: boolean;
  onSelect: () => void;
  shortcut?: string;
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
      aria-keyshortcuts={shortcut}
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
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {shortcut ? (
        <kbd
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-xs font-normal text-subtle-foreground"
        >
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

/**
 * Claude's intent for `preview` is "rendered when the option is focused" — to
 * compare before committing. Selection is the accessible stand-in for focus
 * that also works on touch, and it bounds how much of the composer previews can
 * take. Preformatted mono, capped and scrollable, so a long preview cannot push
 * the buttons off screen. Rendered as a sibling of the option button because a
 * `<pre>` cannot nest inside a `<button>`.
 */
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
  currentIndex: number;
  formState: QuestionFormState;
  onSelect: (index: number) => void;
  questions: readonly InteractionQuestion[];
}

function QuestionTabs({
  currentIndex,
  formState,
  onSelect,
  questions,
}: QuestionTabsProps) {
  return (
    <div className="mb-2 flex shrink-0 items-center gap-2">
      {/* A plain button group, not an ARIA tablist: these toggle which question
          is shown but aren't tab/tabpanel widgets, so role="tablist" would be
          malformed without role="tab" children + panels. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {questions.map((question, index) => {
          const answered = isQuestionAnswered(
            question,
            answerStateFor(formState, question),
          );
          const isActive = index === currentIndex;
          return (
            <div
              key={question.id}
              className={cn(
                "relative inline-flex h-7 shrink-0 items-center rounded-md",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-state-hover",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={isActive}
                title={question.prompt}
                className="flex h-full min-w-0 items-center rounded-md px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
      <span className="shrink-0 text-xs text-muted-foreground">
        {currentIndex + 1} of {questions.length}
      </span>
    </div>
  );
}

interface QuestionInputBlockProps {
  disabled: boolean;
  question: InteractionQuestion;
  state: QuestionAnswerState;
  onToggleOption: (optionValue: string) => void;
  onSelectOther: () => void;
  onFreeTextChange: (value: string) => void;
  /** Cmd/Ctrl+Enter in the free-text box advances/submits (see handleAdvance). */
  onShortcutSubmit: () => void;
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
        {options.map((option: InteractionOption, index) => {
          const checked = state.selected.includes(option.value);
          return (
            <div key={option.value}>
              <QuestionOptionRow
                checked={checked}
                label={option.label}
                description={option.description}
                multiSelect={question.multiSelect}
                onSelect={() => onToggleOption(option.value)}
                shortcut={
                  index < MAX_SHORTCUT_ROWS ? String(index + 1) : undefined
                }
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
            label={OTHER_OPTION_LABEL}
            multiSelect={question.multiSelect}
            onSelect={onSelectOther}
            shortcut={
              options.length < MAX_SHORTCUT_ROWS
                ? String(options.length + 1)
                : undefined
            }
          />
        ) : null}
      </div>
      {state.otherSelected ? (
        <textarea
          ref={freeTextRef}
          aria-label={freeTextLabel}
          value={state.otherText}
          rows={1}
          autoFocus={!isPointerCoarse}
          autoComplete="off"
          onChange={(event) => {
            onFreeTextChange(event.target.value);
            resizeFreeTextArea(event.target);
          }}
          onKeyDown={handleFreeTextKeyDown}
          placeholder="Type your own answer…"
          className="mt-2 w-full resize-none overflow-y-auto rounded-md border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          style={{
            minHeight: `${FREE_TEXT_MIN_HEIGHT}px`,
            maxHeight: `${FREE_TEXT_MAX_HEIGHT}px`,
          }}
        />
      ) : null}
    </fieldset>
  );
}

function AskUserQuestionInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => interactionPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const questions = parsed.success ? parsed.data.questions : [];
  const [formState, setFormState] = useState<QuestionFormState>(() =>
    createInitialFormState(questions),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activeInteractionId, setActiveInteractionId] = useState(
    interaction.id,
  );

  // Reset only when a different interaction takes over. Keyed on the stable
  // interaction id rather than the payload, whose reference churns on
  // background refetch — depending on that would wipe in-progress answers.
  // React's "adjust state during render" pattern always reads the current
  // questions, so no effect (or stale closure) is needed.
  if (activeInteractionId !== interaction.id) {
    setActiveInteractionId(interaction.id);
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

  const updateQuestionState = (
    question: InteractionQuestion,
    update: (state: QuestionAnswerState) => QuestionAnswerState,
  ): void => {
    setFormState((current) => ({
      ...current,
      [question.id]: update(answerStateFor(current, question)),
    }));
  };

  const handleToggleOption = (
    question: InteractionQuestion,
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

  const handleSelectOther = (question: InteractionQuestion): void => {
    updateQuestionState(question, (state) =>
      question.multiSelect
        ? { ...state, otherSelected: !state.otherSelected }
        : { ...state, selected: [], otherSelected: true },
    );
  };

  const handleFreeTextChange = (
    question: InteractionQuestion,
    value: string,
  ): void => {
    updateQuestionState(question, (state) => ({ ...state, otherText: value }));
  };

  const submitAnswer = (): void => {
    if (busy || !allAnswered) return;
    setBusy(true);
    void (async () => {
      try {
        await submit(buildInteractionResponse(questions, formState));
      } catch {
        // The host renders the submission error outside this plugin form.
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleAdvance = (): void => {
    if (isLast) {
      submitAnswer();
      return;
    }
    setCurrentIndex((index) => Math.min(index + 1, totalQuestions - 1));
  };

  const handleCancel = (): void => {
    void (async () => {
      try {
        await cancel();
      } catch {
        // The host renders the cancellation error outside this plugin form.
      }
    })();
  };

  // Number-key answer selection, matching BB's default `question.select.N`
  // bindings (plain digits, inactive while an editable is focused so typing a
  // free-text answer never picks an option).
  useEffect(() => {
    if (busy || currentQuestion === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (!Number.isInteger(digit) || digit < 1 || digit > MAX_SHORTCUT_ROWS) {
        return;
      }
      const choice = resolveQuestionShortcutChoice(currentQuestion, digit - 1);
      if (choice === null) return;
      event.preventDefault();
      if (choice.kind === "option") {
        handleToggleOption(currentQuestion, choice.value);
        return;
      }
      handleSelectOther(currentQuestion);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // handleToggleOption/handleSelectOther only close over the stable
    // setFormState and their question argument, so the current question and
    // busy flag are the whole dependency set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, currentQuestion]);

  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This question could not be displayed.
        </p>
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  if (!currentQuestion) return null;

  const currentState = answerStateFor(formState, currentQuestion);

  return (
    <div className="flex max-h-[calc(100dvh-6rem)] min-h-0 flex-col text-xs text-muted-foreground">
      {totalQuestions > 1 ? (
        <QuestionTabs
          currentIndex={currentIndex}
          formState={formState}
          onSelect={setCurrentIndex}
          questions={questions}
        />
      ) : null}
      <div className="min-h-0 touch-pan-y overflow-y-auto overscroll-contain">
        <QuestionInputBlock
          disabled={busy}
          question={currentQuestion}
          state={currentState}
          onToggleOption={(optionValue) =>
            handleToggleOption(currentQuestion, optionValue)
          }
          onSelectOther={() => handleSelectOther(currentQuestion)}
          onFreeTextChange={(value) =>
            handleFreeTextChange(currentQuestion, value)
          }
          onShortcutSubmit={handleAdvance}
        />
      </div>
      <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
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
              disabled={busy}
              onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
            >
              Back
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || (isLast && !allAnswered)}
            onClick={handleAdvance}
          >
            {busy ? (
              <Icon name="Spinner" className="size-3 animate-spin" />
            ) : null}
            {isLast ? "Submit answer" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: "ask-user-question",
    component: AskUserQuestionInteraction,
  });
});
