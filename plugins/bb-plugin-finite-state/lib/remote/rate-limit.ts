import { RemoteError, type RemoteService } from "./types.js";

export interface Scheduler {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface LimitOptions {
  concurrency: number;
  maxAttempts: number;
  maxBackoffMs: number;
  scheduler: Scheduler;
  random(): number;
}

export const systemScheduler: Scheduler = {
  now: Date.now,
  sleep(ms, signal) {
    if (signal?.aborted)
      return Promise.reject(signal.reason ?? new Error("aborted"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new Error("aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
};

interface Waiter {
  readonly service: RemoteService;
  readonly signal?: AbortSignal;
  readonly resolve: () => void;
  readonly reject: (error: RemoteError) => void;
}

function limiterError(
  service: RemoteService,
  code: string,
  message: string,
): RemoteError {
  return new RemoteError(message, {
    service,
    code,
    status: null,
    retryable: false,
    retryAfterMs: null,
    details: null,
  });
}

export class RemoteLimiter {
  readonly #options: LimitOptions;
  readonly #queue: Waiter[] = [];
  #active = 0;
  #closed = false;
  readonly #closeController = new AbortController();

  constructor(options: LimitOptions) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
      throw new TypeError("concurrency must be a positive integer");
    }
    this.#options = options;
  }

  async #acquire(service: RemoteService, signal?: AbortSignal): Promise<void> {
    if (this.#closed)
      throw limiterError(
        service,
        "REMOTE_LIMITER_CLOSED",
        "Remote limiter is closed",
      );
    if (signal?.aborted)
      throw limiterError(
        service,
        "REMOTE_ABORTED",
        "Remote operation was aborted",
      );
    if (this.#active < this.#options.concurrency && this.#queue.length === 0) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { service, signal, resolve, reject };
      this.#queue.push(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(
            limiterError(
              service,
              "REMOTE_ABORTED",
              "Remote operation was aborted",
            ),
          );
        },
        { once: true },
      );
    });
  }

  #release(): void {
    while (this.#queue.length > 0) {
      const waiter = this.#queue.shift();
      if (waiter?.signal?.aborted) continue;
      waiter?.resolve();
      return;
    }
    this.#active -= 1;
  }

  async run<T>(
    operation: (attempt: number) => Promise<T>,
    signal?: AbortSignal,
    service: RemoteService = "platform",
  ): Promise<T> {
    return await this.#run(
      operation,
      this.#options.maxAttempts,
      signal,
      service,
    );
  }

  async runOnce<T>(
    operation: (attempt: number) => Promise<T>,
    signal?: AbortSignal,
    service: RemoteService = "platform",
  ): Promise<T> {
    return await this.#run(operation, 1, signal, service);
  }

  async #run<T>(
    operation: (attempt: number) => Promise<T>,
    maxAttempts: number,
    signal: AbortSignal | undefined,
    service: RemoteService,
  ): Promise<T> {
    const activeSignal =
      signal === undefined
        ? this.#closeController.signal
        : AbortSignal.any([signal, this.#closeController.signal]);
    await this.#acquire(service, activeSignal);
    try {
      for (let attempt = 1; ; attempt += 1) {
        if (activeSignal.aborted)
          throw limiterError(
            service,
            "REMOTE_ABORTED",
            "Remote operation was aborted",
          );
        try {
          return await operation(attempt);
        } catch (error: unknown) {
          if (
            !(error instanceof RemoteError) ||
            !error.retryable ||
            attempt >= maxAttempts
          ) {
            throw error;
          }
          const exponential = Math.min(
            this.#options.maxBackoffMs,
            1_000 * 2 ** (attempt - 1),
          );
          const jittered = Math.floor(
            exponential * (0.5 + this.#options.random() * 0.5),
          );
          const delay = Math.min(
            error.retryAfterMs ?? jittered,
            this.#options.maxBackoffMs,
          );
          if (activeSignal.aborted) {
            throw limiterError(
              service,
              "REMOTE_ABORTED",
              "Remote operation was aborted",
            );
          }
          try {
            await this.#options.scheduler.sleep(delay, activeSignal);
          } catch {
            throw limiterError(
              service,
              "REMOTE_ABORTED",
              "Remote operation was aborted",
            );
          }
        }
      }
    } finally {
      this.#release();
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeController.abort();
    for (const waiter of this.#queue.splice(0)) {
      waiter.reject(
        limiterError(
          waiter.service,
          "REMOTE_LIMITER_CLOSED",
          "Remote limiter is closed",
        ),
      );
    }
  }
}
