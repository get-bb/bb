import type {
  PendingInteractionUserAnswer,
  PendingInteractionUserQuestionQuestion,
  UserQuestionPendingInteractionResolution,
} from "@bb/domain";

/**
 * Per-question answer state for the user-question form.
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

function questionHasOptions(
  question: PendingInteractionUserQuestionQuestion,
): boolean {
  return (question.options?.length ?? 0) > 0;
}

export function createInitialFormState(
  questions: readonly PendingInteractionUserQuestionQuestion[],
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
  question: PendingInteractionUserQuestionQuestion,
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
  question: PendingInteractionUserQuestionQuestion,
  selectedValues: readonly string[],
): string[] {
  const optionValues = new Set(
    (question.options ?? []).map((option) => option.value),
  );
  return selectedValues.filter((value) => optionValues.has(value));
}

export function isQuestionAnswered(
  question: PendingInteractionUserQuestionQuestion,
  state: QuestionAnswerState,
): boolean {
  if (validSelectedValues(question, state.selected).length > 0) {
    return true;
  }
  return state.otherSelected && state.otherText.trim().length > 0;
}

function buildQuestionAnswer(
  question: PendingInteractionUserQuestionQuestion,
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

export function buildUserAnswerResolution(
  questions: readonly PendingInteractionUserQuestionQuestion[],
  formState: QuestionFormState,
): UserQuestionPendingInteractionResolution {
  const answers: Record<string, PendingInteractionUserAnswer> = {};
  for (const question of questions) {
    answers[question.id] = buildQuestionAnswer(
      question,
      answerStateFor(formState, question),
    );
  }
  return { kind: "user_answer", answers };
}
