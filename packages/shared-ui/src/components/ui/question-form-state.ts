export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
  preview?: string;
}

export interface Question {
  id: string;
  prompt: string;
  shortLabel: string;
  multiSelect: boolean;
  allowFreeText: boolean;
  options: readonly QuestionOption[];
}

export type QuestionAnswer = {
  selected: string[];
  freeText?: string;
};

export interface QuestionAnswerState {
  selected: string[];
  otherSelected: boolean;
  otherText: string;
}

export type QuestionFormState = Record<string, QuestionAnswerState>;

function questionHasOptions(question: Question): boolean {
  return question.options.length > 0;
}

export function createInitialFormState(
  questions: readonly Question[],
): QuestionFormState {
  const state: QuestionFormState = {};
  for (const question of questions) {
    state[question.id] = {
      selected: [],
      otherSelected: !questionHasOptions(question),
      otherText: "",
    };
  }
  return state;
}

export function answerStateFor(
  formState: QuestionFormState,
  question: Question,
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
  question: Question,
  selectedValues: readonly string[],
): string[] {
  const optionValues = new Set(question.options.map((option) => option.value));
  return selectedValues.filter((value) => optionValues.has(value));
}

export function isQuestionAnswered(
  question: Question,
  state: QuestionAnswerState,
): boolean {
  if (validSelectedValues(question, state.selected).length > 0) return true;
  return state.otherSelected && state.otherText.trim().length > 0;
}

function buildQuestionAnswer(
  question: Question,
  state: QuestionAnswerState,
): QuestionAnswer {
  const freeText = state.otherText.trim();
  const includeFreeText = state.otherSelected && freeText.length > 0;
  if (question.multiSelect) {
    const selected = validSelectedValues(question, state.selected);
    return includeFreeText ? { selected, freeText } : { selected };
  }
  if (state.otherSelected) {
    return includeFreeText ? { selected: [], freeText } : { selected: [] };
  }
  return { selected: validSelectedValues(question, state.selected) };
}

export function buildQuestionAnswers(
  questions: readonly Question[],
  formState: QuestionFormState,
): Record<string, QuestionAnswer> {
  const answers: Record<string, QuestionAnswer> = {};
  for (const question of questions) {
    answers[question.id] = buildQuestionAnswer(
      question,
      answerStateFor(formState, question),
    );
  }
  return answers;
}

export type QuestionShortcutChoice =
  | { kind: "option"; value: string }
  | { kind: "other" }
  | null;

export function resolveQuestionShortcutChoice(
  question: Question,
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
