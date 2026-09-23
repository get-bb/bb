// bb-fork(windows): keep a partially filled question form across a page reload
// bb-fork(windows): (dev server restarts, HMR, a manual reload) keyed by the
// bb-fork(windows): pending interaction id, so a long multi-question form does
// bb-fork(windows): not throw away the answers already chosen.
import {
  createInitialFormState,
  type Question,
  type QuestionFormState,
} from "./question-form-state.js";

export interface QuestionFormDraftSnapshot {
  currentIndex: number;
  formState: QuestionFormState;
}

const STORAGE_KEY_PREFIX = "bb.questionDraft.v1.";
const MAX_DRAFT_TEXT_LENGTH = 8192;

function storageKey(draftKey: string): string {
  return `${STORAGE_KEY_PREFIX}${draftKey}`;
}

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreQuestionState(
  defaultState: QuestionFormState[string],
  storedEntry: unknown,
  question: Question,
): QuestionFormState[string] {
  if (!isRecord(storedEntry)) return defaultState;
  const optionValues = new Set(question.options.map((option) => option.value));
  const selected = Array.isArray(storedEntry.selected)
    ? storedEntry.selected.filter(
        (value): value is string =>
          typeof value === "string" && optionValues.has(value),
      )
    : [];
  const otherText =
    typeof storedEntry.otherText === "string"
      ? storedEntry.otherText.slice(0, MAX_DRAFT_TEXT_LENGTH)
      : "";
  return {
    selected,
    otherSelected:
      defaultState.otherSelected || storedEntry.otherSelected === true,
    otherText,
  };
}

export function readQuestionFormDraft(
  draftKey: string | undefined,
  questions: readonly Question[],
): QuestionFormDraftSnapshot | null {
  if (draftKey === undefined || draftKey.length === 0) return null;
  const storage = readStorage();
  if (storage === null) return null;
  let parsed: unknown;
  try {
    const text = storage.getItem(storageKey(draftKey));
    if (text === null) return null;
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const formState = createInitialFormState(questions);
  const storedFormState = parsed.formState;
  if (isRecord(storedFormState)) {
    for (const question of questions) {
      formState[question.id] = restoreQuestionState(
        formState[question.id],
        storedFormState[question.id],
        question,
      );
    }
  }
  const lastIndex = Math.max(questions.length - 1, 0);
  const storedIndex = parsed.currentIndex;
  const currentIndex =
    typeof storedIndex === "number" && Number.isInteger(storedIndex)
      ? Math.min(Math.max(storedIndex, 0), lastIndex)
      : 0;
  return { currentIndex, formState };
}

export function writeQuestionFormDraft(
  draftKey: string | undefined,
  snapshot: QuestionFormDraftSnapshot,
): void {
  if (draftKey === undefined || draftKey.length === 0) return;
  const storage = readStorage();
  if (storage === null) return;
  try {
    storage.setItem(storageKey(draftKey), JSON.stringify(snapshot));
  } catch {
    return;
  }
}

export function clearQuestionFormDraft(draftKey: string | undefined): void {
  if (draftKey === undefined || draftKey.length === 0) return;
  const storage = readStorage();
  if (storage === null) return;
  try {
    storage.removeItem(storageKey(draftKey));
  } catch {
    return;
  }
}
