import { errorMessage } from "../../shared/errors.js";

export interface DescriptionSaveOutcome {
  ok: boolean;
  errorMessage?: string;
}

export async function saveDescriptionMutation(
  write: () => Promise<void>,
): Promise<DescriptionSaveOutcome> {
  try {
    await write();
    return { ok: true };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "conflict" || error.code === "invalid")
    )
      return { ok: false, errorMessage: error.message };
    throw error;
  }
}

interface DescriptionSaverOptions {
  save(taskId: string, markdown: string): Promise<DescriptionSaveOutcome>;
  onError(message: string): void;
  delayMs: number;
}

export interface DescriptionSaver {
  onChange(taskId: string, markdown: string): void;
  flush(taskId: string): void;
  hasPending(): boolean;
}

export function createDescriptionSaver(
  options: DescriptionSaverOptions,
): DescriptionSaver {
  const schedule = (run: () => void, delayMs: number) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  };

  let cancelTimer: (() => void) | undefined;
  let pending: { taskId: string; markdown: string } | undefined;

  const runSave = async (attempt: { taskId: string; markdown: string }) => {
    try {
      const result = await options.save(attempt.taskId, attempt.markdown);
      if (pending === attempt) pending = undefined;
      if (!result.ok && result.errorMessage !== undefined) {
        options.onError(result.errorMessage);
      }
    } catch (error) {
      options.onError(errorMessage(error));
    }
  };

  return {
    onChange(taskId, markdown) {
      pending = { taskId, markdown };
      cancelTimer?.();
      const attempt = pending;
      cancelTimer = schedule(() => {
        void runSave(pending ?? attempt);
      }, options.delayMs);
    },
    flush(taskId) {
      cancelTimer?.();
      cancelTimer = undefined;
      if (pending === undefined || pending.taskId !== taskId) return;
      const attempt = pending;
      pending = undefined;
      void options
        .save(attempt.taskId, attempt.markdown)
        .catch(() => undefined);
    },
    hasPending: () => pending !== undefined,
  };
}
