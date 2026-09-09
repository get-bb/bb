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
  type State = {
    nextTask: (() => Promise<void>) | null;
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

      const state: State = {
        nextTask: task,
        promise: Promise.resolve(),
      };
      const drain = async (): Promise<void> => {
        let failed = false;
        let firstError: unknown;
        while (state.nextTask !== null) {
          const nextTask = state.nextTask;
          state.nextTask = null;
          try {
            await nextTask();
          } catch (error) {
            if (!failed) {
              failed = true;
              firstError = error;
            }
          }
        }
        if (failed) {
          throw firstError;
        }
      };
      state.promise = Promise.resolve()
        .then(drain)
        .finally(() => {
          if (pendingByKey.get(key) === state) {
            pendingByKey.delete(key);
          }
        });
      pendingByKey.set(key, state);
      return state.promise;
    },
  };
}
