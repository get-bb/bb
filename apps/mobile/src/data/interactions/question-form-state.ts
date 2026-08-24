import type {
  PendingInteractionUserAnswer,
  PendingInteractionUserQuestionQuestion,
  UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import type {
  InteractionQuestion as AskUserQuestionInteractionQuestion,
  InteractionResponse as AskUserQuestionInteractionResponse,
} from "@bb/plugin-interaction-contracts";

/**
 * Form state for the question forms the pending-interaction banner renders
 * (ports apps/app/src/components/thread/user-questions/user-question-form-state.ts
 * and plugins/ask-user-question/src/form-state.ts, which are the same model).
 *
 * Both the provider-native `user_question` payload and the `ask-user-question`
 * plugin payload normalize to `InteractionFormQuestion`, so one form + one
 * state machine serve both; only the response envelope differs
 * (`buildUserAnswerResolution` vs `buildAskUserQuestionResponse`).
 *
 * Free text is modeled as an explicit "Other" choice (`otherSelected`) rather
 * than a parallel always-on text box: for single-select, picking a real
 * option clears it and picking "Other" clears the selection; for multi-select
 * the two coexist. This keeps the on-screen model aligned with what we send
 * back — `selected` and `freeText` are never ambiguously both-set for
 * single-select.
 */

export interface InteractionFormOption {
  value: string;
  label: string;
  description?: string;
  /** Freeform preview (mockup, diff, snippet) shown while the option is selected. */
  preview?: string;
}

export interface InteractionFormQuestion {
  id: string;
  prompt: string;
  shortLabel: string;
  multiSelect: boolean;
  options: readonly InteractionFormOption[];
  allowFreeText: boolean;
}

export interface QuestionAnswerState {
  selected: string[];
  otherSelected: boolean;
  otherText: string;
}

export type QuestionFormState = Record<string, QuestionAnswerState>;

export function normalizeUserQuestion(
  question: PendingInteractionUserQuestionQuestion,
  index: number,
): InteractionFormQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    shortLabel: question.shortLabel ?? `Question ${index + 1}`,
    multiSelect: question.multiSelect,
    options: (question.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.description !== undefined
        ? { description: option.description }
        : {}),
    })),
    allowFreeText: question.allowFreeText,
  };
}

export function normalizeUserQuestions(
  questions: readonly PendingInteractionUserQuestionQuestion[],
): InteractionFormQuestion[] {
  return questions.map(normalizeUserQuestion);
}

export function normalizeAskUserQuestion(
  question: AskUserQuestionInteractionQuestion,
): InteractionFormQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    shortLabel: question.shortLabel,
    multiSelect: question.multiSelect,
    options: question.options.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.description !== undefined
        ? { description: option.description }
        : {}),
      ...(option.preview !== undefined ? { preview: option.preview } : {}),
    })),
    allowFreeText: question.allowFreeText,
  };
}

export function normalizeAskUserQuestions(
  questions: readonly AskUserQuestionInteractionQuestion[],
): InteractionFormQuestion[] {
  return questions.map(normalizeAskUserQuestion);
}

function questionHasOptions(question: InteractionFormQuestion): boolean {
  return question.options.length > 0;
}

function initialAnswerState(
  question: InteractionFormQuestion,
): QuestionAnswerState {
  return {
    selected: [],
    // A question with no options is pure free text — "Other" is implicit.
    otherSelected: !questionHasOptions(question),
    otherText: "",
  };
}

export function createInitialFormState(
  questions: readonly InteractionFormQuestion[],
): QuestionFormState {
  const state: QuestionFormState = {};
  for (const question of questions) {
    state[question.id] = initialAnswerState(question);
  }
  return state;
}

export function answerStateFor(
  formState: QuestionFormState,
  question: InteractionFormQuestion,
): QuestionAnswerState {
  return formState[question.id] ?? initialAnswerState(question);
}

function validSelectedValues(
  question: InteractionFormQuestion,
  selectedValues: readonly string[],
): string[] {
  const optionValues = new Set(question.options.map((option) => option.value));
  return selectedValues.filter((value) => optionValues.has(value));
}

export function isQuestionAnswered(
  question: InteractionFormQuestion,
  state: QuestionAnswerState,
): boolean {
  if (validSelectedValues(question, state.selected).length > 0) return true;
  return state.otherSelected && state.otherText.trim().length > 0;
}

export function areAllQuestionsAnswered(
  questions: readonly InteractionFormQuestion[],
  formState: QuestionFormState,
): boolean {
  return (
    questions.length > 0 &&
    questions.every((question) =>
      isQuestionAnswered(question, answerStateFor(formState, question)),
    )
  );
}

/** Tap on an option row: single-select replaces, multi-select toggles. */
export function toggleQuestionOption(
  question: InteractionFormQuestion,
  state: QuestionAnswerState,
  optionValue: string,
): QuestionAnswerState {
  if (question.multiSelect) {
    const selected = state.selected.includes(optionValue)
      ? state.selected.filter((value) => value !== optionValue)
      : [...state.selected, optionValue];
    return { ...state, selected };
  }
  return { ...state, selected: [optionValue], otherSelected: false };
}

/** Tap on the "Other…" row. */
export function toggleQuestionOther(
  question: InteractionFormQuestion,
  state: QuestionAnswerState,
): QuestionAnswerState {
  return question.multiSelect
    ? { ...state, otherSelected: !state.otherSelected }
    : { ...state, selected: [], otherSelected: true };
}

export function setQuestionFreeText(
  state: QuestionAnswerState,
  value: string,
): QuestionAnswerState {
  return { ...state, otherText: value };
}

function buildQuestionAnswer(
  question: InteractionFormQuestion,
  state: QuestionAnswerState,
): PendingInteractionUserAnswer {
  const freeText = state.otherText.trim();
  const includeFreeText = state.otherSelected && freeText.length > 0;
  if (question.multiSelect) {
    const selected = validSelectedValues(question, state.selected);
    return includeFreeText ? { selected, freeText } : { selected };
  }
  // Single-select: "Other" replaces any option choice, so the two are exclusive.
  if (state.otherSelected) {
    return includeFreeText ? { selected: [], freeText } : { selected: [] };
  }
  return { selected: validSelectedValues(question, state.selected) };
}

function buildAnswers(
  questions: readonly InteractionFormQuestion[],
  formState: QuestionFormState,
): Record<string, PendingInteractionUserAnswer> {
  const answers: Record<string, PendingInteractionUserAnswer> = {};
  for (const question of questions) {
    answers[question.id] = buildQuestionAnswer(
      question,
      answerStateFor(formState, question),
    );
  }
  return answers;
}

/** `POST /threads/:id/interactions/:iid/resolve` body for a `user_question`. */
export function buildUserAnswerResolution(
  questions: readonly InteractionFormQuestion[],
  formState: QuestionFormState,
): UserQuestionPendingInteractionResolution {
  return { kind: "user_answer", answers: buildAnswers(questions, formState) };
}

/** `POST /threads/:id/interactions/:iid/respond` value for `ask-user-question`. */
export function buildAskUserQuestionResponse(
  questions: readonly InteractionFormQuestion[],
  formState: QuestionFormState,
): AskUserQuestionInteractionResponse {
  return { answers: buildAnswers(questions, formState) };
}
