import { resolveReadChange } from "@bb/query-changes/policy";
import {
  type ReadChange,
  type ReadDependency,
  type ReadChangeReaction,
} from "@bb/domain";
import { BbHttpError } from "./response.js";

export type PluginReadWatch = (() => void) & {
  refresh(): void;
  done: Promise<void>;
};

export function createPluginReadWatcher<T>(options: {
  signal: AbortSignal;
  read(signal: AbortSignal): Promise<T>;
  prepare?(value: T): void | Promise<void>;
  dependenciesOf?(value: T): readonly ReadDependency[];
  reactToChange?(
    value: T | undefined,
    change: ReadChange,
  ): ReadChangeReaction<T>;
  prepareKey?(value: T): string;
  onChange(value: T): void;
  onError?(error: Error): void;
  onStop(): void;
  retryNotFound?: boolean;
}): PluginReadWatch & { change(change: ReadChange): void } {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let revision = 0;
  let value: T | undefined;
  let dependencies: readonly ReadDependency[] = [];
  const pendingChanges: ReadChange[] = [];
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
  const retryWhenReady = () => {
    if (stopped) return;
    const remaining = blockedUntil - Date.now();
    if (remaining <= 0) {
      refresh();
      return;
    }
    retry = setTimeout(retryWhenReady, remaining);
    retry.unref?.();
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
      retryWhenReady();
    }
  };
  const schedule = () => {
    if (stopped || running || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      void run();
    });
  };
  const publish = (value: T, current: number) => {
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
  };
  const run = async () => {
    scheduled = false;
    if (stopped) return;
    running = true;
    const current = revision;
    pendingChanges.length = 0;
    controller = new AbortController();
    try {
      const next = await options.read(controller.signal);
      if (stopped || current !== revision) return;
      dependencies = options.dependenciesOf?.(next) ?? [];
      if (
        pendingChanges.some((change) =>
          resolveReadChange(next, dependencies, change, options.reactToChange),
        )
      ) {
        refresh();
        return;
      }
      value = next;
      publish(next, current);
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
    change(change: ReadChange) {
      if (stopped) return;
      if (running) pendingChanges.push(change);
      const reaction = resolveReadChange(
        value,
        dependencies,
        change,
        options.reactToChange,
      );
      if (!reaction) return;
      if (reaction.action === "patch" && value !== undefined && !running) {
        value = reaction.data;
        publish(value, ++revision);
      } else refresh();
    },
  });
}
