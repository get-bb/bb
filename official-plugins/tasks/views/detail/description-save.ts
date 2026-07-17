/** Outcome of one save attempt against the updateTask RPC. */
export interface DescriptionSaveOutcome {
  ok: boolean;
  errorMessage?: string;
}

export interface DescriptionSaverOptions {
  save(taskId: string, markdown: string): Promise<DescriptionSaveOutcome>;
  onError(message: string): void;
  delayMs: number;
  /** Timer injection point for tests; returns a cancel function. */
  schedule?(run: () => void, delayMs: number): () => void;
}

export interface DescriptionSaver {
  /** Record a new draft and (re)start the debounce timer. */
  onChange(taskId: string, markdown: string): void;
  /** Fire any pending draft for `taskId` immediately (unmount/task switch). */
  flush(taskId: string): void;
  hasPending(): boolean;
}

/**
 * Debounced description autosave. The pending draft is cleared only once the
 * server has handled the request (success or domain rejection) — a transport
 * failure keeps it pending so the unmount flush or the next debounce tick
 * retries instead of silently dropping the draft.
 */
export function createDescriptionSaver(
  options: DescriptionSaverOptions,
): DescriptionSaver {
  const schedule =
    options.schedule ??
    ((run: () => void, delayMs: number) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    });

  let cancelTimer: (() => void) | undefined;
  let pending: { taskId: string; markdown: string } | undefined;

  const runSave = async (attempt: { taskId: string; markdown: string }) => {
    try {
      const result = await options.save(attempt.taskId, attempt.markdown);
      // A newer draft may have arrived while the RPC was in flight; only the
      // attempt that was actually sent is settled.
      if (pending === attempt) pending = undefined;
      if (!result.ok && result.errorMessage !== undefined) {
        options.onError(result.errorMessage);
      }
    } catch (error) {
      options.onError(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    onChange(taskId, markdown) {
      pending = { taskId, markdown };
      cancelTimer?.();
      const attempt = pending;
      cancelTimer = schedule(() => {
        // Send whatever is pending now — a retry after a transport failure
        // should carry the latest draft, not the one that armed the timer.
        void runSave(pending ?? attempt);
      }, options.delayMs);
    },
    flush(taskId) {
      cancelTimer?.();
      cancelTimer = undefined;
      if (pending === undefined || pending.taskId !== taskId) return;
      const attempt = pending;
      pending = undefined;
      // Fire-and-forget: the component is unmounting, so there is nothing
      // left to retry from — but the draft got its send.
      void options.save(attempt.taskId, attempt.markdown).catch(() => undefined);
    },
    hasPending: () => pending !== undefined,
  };
}
