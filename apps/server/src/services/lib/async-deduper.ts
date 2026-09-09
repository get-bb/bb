export interface AsyncDeduper<TKey, TValue> {
  run(key: TKey, task: () => Promise<TValue>): Promise<TValue>;
}

export interface AsyncRerunner<TKey> {
  run(key: TKey, task: () => Promise<void>): Promise<void>;
}

export function createAsyncDeduper<TKey, TValue>(): AsyncDeduper<TKey, TValue> {
  const pendingByKey = new Map<TKey, Promise<TValue>>();

  return {
    run(key, task) {
      const pendingTask = pendingByKey.get(key);
      if (pendingTask) {
        return pendingTask;
      }

      const startedTask = task().finally(() => {
        if (pendingByKey.get(key) === startedTask) {
          pendingByKey.delete(key);
        }
      });
      pendingByKey.set(key, startedTask);
      return startedTask;
    },
  };
}

export function createAsyncRerunner<TKey>(): AsyncRerunner<TKey> {
  type Task = () => Promise<void>;
  type State = {
    nextTask: Task | null;
    promise: Promise<void>;
  };
  const pendingByKey = new Map<TKey, State>();

  return {
    run(key, task) {
      const pending = pendingByKey.get(key);
      if (pending !== undefined) {
        pending.nextTask = task;
        return pending.promise;
      }

      let resolveCompletion: (() => void) | null = null;
      let rejectCompletion: ((reason?: unknown) => void) | null = null;
      const completion = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      if (resolveCompletion === null || rejectCompletion === null) {
        throw new Error("Failed to create rerunner completion promise");
      }
      const state: State = {
        nextTask: null,
        promise: completion,
      };
      pendingByKey.set(key, state);

      const drain = async (firstTask: Task): Promise<void> => {
        let failed = false;
        let firstError: unknown;
        let nextTask: Task | null = firstTask;
        while (nextTask !== null) {
          state.nextTask = null;
          try {
            await nextTask();
          } catch (error) {
            if (!failed) {
              failed = true;
              firstError = error;
            }
          }
          nextTask = state.nextTask;
        }
        if (pendingByKey.get(key) === state) {
          pendingByKey.delete(key);
        }
        if (failed) {
          throw firstError;
        }
      };
      void drain(task).then(resolveCompletion, rejectCompletion);
      return completion;
    },
  };
}
