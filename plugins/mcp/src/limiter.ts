export interface Limiter {
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T>;
}

export function createLimiter(maxConcurrent: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted)
      return Promise.reject(new Error("The call was cancelled."));
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener("abort", cancel);
        active += 1;
        resolve();
      };
      const cancel = () => {
        const index = waiting.indexOf(grant);
        if (index !== -1) waiting.splice(index, 1);
        reject(new Error("The call was cancelled."));
      };
      waiting.push(grant);
      signal.addEventListener("abort", cancel, { once: true });
    });
  };

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return {
    async run(task, signal) {
      await acquire(signal);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
