import { BbHttpError } from "./response.js";

export type PluginReadWatch = (() => void) & {
  refresh(): void;
  done: Promise<void>;
};

export function createPluginReadWatcher<T>(options: {
  signal: AbortSignal;
  read(signal: AbortSignal): Promise<T>;
  prepare?(value: T): void | Promise<void>;
  tagsOf?(value: T): readonly string[];
  prepareKey?(value: T): string;
  onChange(value: T): void;
  onError?(error: Error): void;
  onStop(): void;
  retryNotFound?: boolean;
}): PluginReadWatch & { invalidate(tags: readonly string[] | null): void } {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let revision = 0;
  let tags: readonly string[] | undefined;
  const pendingTags = new Set<string>();
  let running = false;
  let scheduled = false;
  let stopped = false;
  let failures = 0;
  let preparedKey: string | undefined;
  let blockedUntil = 0;
  let preparing = 0;
  let pending = Promise.resolve();
  let controller: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const drained = () => {
    if (stopped && !running && preparing === 0) finish();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(retry);
    controller?.abort();
    options.signal.removeEventListener("abort", stop);
    options.onStop();
    drained();
  };
  const failed = (error: unknown, current: number) => {
    if (stopped || current !== revision) return;
    const permanent =
      error instanceof BbHttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 429 &&
      !(options.retryNotFound && error.status === 404);
    preparedKey = undefined;
    options.onError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
    if (stopped) return;
    if (permanent) stop();
    else {
      const delay = Math.min(30_000, 1_000 * 2 ** failures++);
      blockedUntil = Date.now() + delay;
      clearTimeout(retry);
      retry = setTimeout(refresh, delay);
      retry.unref?.();
    }
  };
  const schedule = () => {
    if (stopped || running || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      void run();
    });
  };
  const run = async () => {
    scheduled = false;
    if (stopped) return;
    running = true;
    const current = revision;
    pendingTags.clear();
    controller = new AbortController();
    try {
      const value = await options.read(controller.signal);
      if (stopped || current !== revision) return;
      tags = options.tagsOf?.(value);
      if (tags?.some((tag) => pendingTags.has(tag))) {
        refresh();
        return;
      }
      preparing++;
      pending = pending
        .then(async () => {
          if (stopped || current !== revision) return;
          if (Date.now() < blockedUntil) return;
          const key = options.prepareKey?.(value);
          if (key === undefined || key !== preparedKey)
            await options.prepare?.(value);
          if (stopped || current !== revision) return;
          preparedKey = key;
          options.onChange(value);
          failures = 0;
        })
        .catch((error: unknown) => failed(error, current))
        .finally(() => {
          preparing--;
          drained();
        });
    } catch (error) {
      failed(error, current);
    } finally {
      running = false;
      drained();
      if (!stopped && current !== revision) schedule();
    }
  };
  const refresh = () => {
    if (Date.now() >= blockedUntil) clearTimeout(retry);
    revision++;
    controller?.abort();
    schedule();
  };
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop();
  return Object.assign(stop, {
    refresh,
    done,
    invalidate(invalidated: readonly string[] | null) {
      if (
        invalidated === null ||
        (tags === undefined && !running) ||
        tags?.some((tag) => invalidated.includes(tag))
      )
        refresh();
      else if (running) for (const tag of invalidated) pendingTags.add(tag);
    },
  });
}
