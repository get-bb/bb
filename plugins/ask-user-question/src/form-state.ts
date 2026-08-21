import type {
  InteractionAnswer,
  InteractionQuestion,
  InteractionResponse,
} from "./contracts.js";

/**
 * Per-question answer state, ported from BB's native user-question form.
 *
 * Free text is modeled as an explicit "Other" choice (`otherSelected`) rather
 * than a parallel always-on textarea: for single-select, picking a real option
 * clears it and picking "Other" clears the selection; for multi-select the two
 * coexist. This keeps the on-screen model aligned with what we send back —
 * `selected` and `freeText` are never ambiguously both-set for single-select.
 */
export interface QuestionAnswerState {
  selected: string[];
  otherSelected: boolean;
  otherText: string;
}

export type QuestionFormState = Record<string, QuestionAnswerState>;

function questionHasOptions(question: InteractionQuestion): boolean {
  return question.options.length > 0;
}

export function createInitialFormState(
  questions: readonly InteractionQuestion[],
): QuestionFormState {
  const state: QuestionFormState = {};
  for (const question of questions) {
    state[question.id] = {
      selected: [],
      // A question with no options is pure free text — "Other" is implicit.
      otherSelected: !questionHasOptions(question),
      otherText: "",
    };
  }
  return state;
}

export function answerStateFor(
  formState: QuestionFormState,
  question: InteractionQuestion,
): QuestionAnswerState {
  return (
    formState[question.id] ?? {
      selected: [],
      otherSelected: !questionHasOptions(question),
      otherText: "",
    }
  );
}

function validSelectedValues(
  question: InteractionQuestion,
  selectedValues: readonly string[],
): string[] {
  const optionValues = new Set(question.options.map((option) => option.value));
  return selectedValues.filter((value) => optionValues.has(value));
}

export function isQuestionAnswered(
  question: InteractionQuestion,
  state: QuestionAnswerState,
): boolean {
  if (validSelectedValues(question, state.selected).length > 0) return true;
  return state.otherSelected && state.otherText.trim().length > 0;
}

function buildQuestionAnswer(
  question: InteractionQuestion,
  state: QuestionAnswerState,
): InteractionAnswer {
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

export function buildInteractionResponse(
  questions: readonly InteractionQuestion[],
  formState: QuestionFormState,
): InteractionResponse {
  const answers: Record<string, InteractionAnswer> = {};
  for (const question of questions) {
    answers[question.id] = buildQuestionAnswer(
      question,
      answerStateFor(formState, question),
    );
  }
  return { answers };
}

export type QuestionShortcutChoice =
  | { kind: "option"; value: string }
  | { kind: "other" }
  | null;

/**
 * Maps a 0-based shortcut index to the row it selects: the options in order,
 * then the trailing "Other…" row.
 */
export function resolveQuestionShortcutChoice(
  question: InteractionQuestion,
  index: number,
): QuestionShortcutChoice {
  const option = question.options[index];
  if (option) return { kind: "option", value: option.value };
  if (
    index === question.options.length &&
    question.options.length > 0 &&
    question.allowFreeText
  ) {
    return { kind: "other" };
  }
  return null;
}
