import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  createInitialFormState,
  type Question,
  type QuestionFormState,
} from "./question-form-state";

interface QuestionDraft {
  formState: QuestionFormState;
  currentIndex: number;
}

const CHANGE_EVENT = "bb.question-draft.changed";
const drafts = new Map<
  string,
  { raw: string | null; signature: string; draft: QuestionDraft }
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDraft(
  raw: string | null,
  questions: readonly Question[],
  signature: string,
): QuestionDraft | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      value.signature !== signature ||
      !isRecord(value.formState) ||
      typeof value.currentIndex !== "number" ||
      !Number.isInteger(value.currentIndex) ||
      value.currentIndex < 0 ||
      value.currentIndex >= questions.length
    )
      return null;
    const formState: QuestionFormState = {};
    for (const question of questions) {
      const answer = value.formState[question.id];
      if (
        !isRecord(answer) ||
        !Array.isArray(answer.selected) ||
        !answer.selected.every(
          (selected: unknown) => typeof selected === "string",
        ) ||
        typeof answer.otherSelected !== "boolean" ||
        typeof answer.otherText !== "string"
      )
        return null;
      formState[question.id] = {
        selected: answer.selected.filter((selected: string) =>
          question.options.some((option) => option.value === selected),
        ),
        otherSelected: answer.otherSelected,
        otherText: answer.otherText,
      };
    }
    return { formState, currentIndex: value.currentIndex };
  } catch {
    return null;
  }
}

export function useQuestionFormDraft(
  draftKey: string | undefined,
  questions: readonly Question[],
) {
  const storageKey = draftKey ? `bb.question-draft.v1:${draftKey}` : null;
  const signature = JSON.stringify(questions);
  const initialDraft = useMemo(
    () => ({ formState: createInitialFormState(questions), currentIndex: 0 }),
    [questions],
  );
  const [localDraft, setLocalDraft] = useState(initialDraft);
  const getSnapshot = useCallback((): QuestionDraft => {
    if (!storageKey || typeof window === "undefined") return initialDraft;
    const cached = drafts.get(storageKey);
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(storageKey);
    } catch {
      return cached?.signature === signature ? cached.draft : initialDraft;
    }
    if (cached?.raw === raw && cached.signature === signature)
      return cached.draft;
    const draft = parseDraft(raw, questions, signature) ?? initialDraft;
    drafts.set(storageKey, { raw, signature, draft });
    return draft;
  }, [storageKey, questions, signature, initialDraft]);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!storageKey || typeof window === "undefined") return () => {};
      window.addEventListener(CHANGE_EVENT, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(CHANGE_EVENT, listener);
        window.removeEventListener("storage", listener);
      };
    },
    [storageKey],
  );
  const storedDraft = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => initialDraft,
  );
  const writeDraft = (draft: QuestionDraft, clear = false) => {
    if (!storageKey || typeof window === "undefined") {
      setLocalDraft(draft);
      return;
    }
    const raw = clear
      ? null
      : JSON.stringify({ version: 1, signature, ...draft });
    let storedRaw: string | null = null;
    try {
      storedRaw = window.localStorage.getItem(storageKey);
      if (raw === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, raw);
      storedRaw = raw;
    } catch {}
    drafts.set(storageKey, { raw: storedRaw, signature, draft });
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  const draft = storageKey ? storedDraft : localDraft;
  return {
    ...draft,
    setFormState: (update: (state: QuestionFormState) => QuestionFormState) => {
      const current = storageKey ? getSnapshot() : localDraft;
      writeDraft({ ...current, formState: update(current.formState) });
    },
    setCurrentIndex: (update: number | ((index: number) => number)) => {
      const current = storageKey ? getSnapshot() : localDraft;
      writeDraft({
        ...current,
        currentIndex:
          typeof update === "number" ? update : update(current.currentIndex),
      });
    },
    clearDraft: () => {
      if (
        !storageKey ||
        JSON.stringify(getSnapshot().formState) ===
          JSON.stringify(draft.formState)
      )
        writeDraft(initialDraft, true);
    },
  };
}
