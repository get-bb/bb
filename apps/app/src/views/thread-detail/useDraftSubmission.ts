import { useMemo, useSyncExternalStore } from "react";

type Submission = { pending: boolean; listeners: Set<() => void> };

const submissions = new Map<string, Submission>();

function getSubmission(key: string): Submission {
  let submission = submissions.get(key);
  if (!submission) {
    submission = { pending: false, listeners: new Set() };
    submissions.set(key, submission);
  }
  return submission;
}

function discardUnusedSubmission(key: string, submission: Submission) {
  if (
    !submission.pending &&
    submission.listeners.size === 0 &&
    submissions.get(key) === submission
  ) {
    submissions.delete(key);
  }
}

function notify(submission: Submission) {
  for (const listener of submission.listeners) listener();
}

export function useDraftSubmission(storageKey: string) {
  const store = useMemo(
    () => ({
      getSnapshot: () => submissions.get(storageKey)?.pending ?? false,
      subscribe: (listener: () => void) => {
        const submission = getSubmission(storageKey);
        submission.listeners.add(listener);
        return () => {
          submission.listeners.delete(listener);
          discardUnusedSubmission(storageKey, submission);
        };
      },
      submitDraft: async (action: () => Promise<void>) => {
        const submission = getSubmission(storageKey);
        if (submission.pending) {
          throw new Error("A message is already being submitted.");
        }
        submission.pending = true;
        try {
          notify(submission);
          await action();
        } finally {
          submission.pending = false;
          notify(submission);
          discardUnusedSubmission(storageKey, submission);
        }
      },
    }),
    [storageKey],
  );

  return {
    isSubmitting: useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      () => false,
    ),
    submitDraft: store.submitDraft,
  };
}
