import { raceTimeout } from "./plugin-time-box.js";

type StartSearch<Result> = (signal: AbortSignal) => Result | Promise<Result>;

interface QueuedSearch<Result> {
  start: StartSearch<Result>;
  signal: AbortSignal;
  settle: (run: Promise<Result> | null) => void;
}

interface SearchSlot<Result> {
  stalled: boolean;
  queued: QueuedSearch<Result> | null;
}

export interface MentionSearchSlots<Key extends object, Result> {
  search(
    key: Key,
    start: StartSearch<Result>,
    signal: AbortSignal,
  ): Promise<Result | null>;
}

async function unlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T | null> {
  let onAbort = () => {};
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function createMentionSearchSlots<Key extends object, Result>(
  timeoutMs: number,
): MentionSearchSlots<Key, Result> {
  const slots = new WeakMap<Key, SearchSlot<Result>>();
  const timeoutMessage = `timed out after ${timeoutMs}ms`;

  function begin(
    key: Key,
    start: StartSearch<Result>,
    signal: AbortSignal,
  ): Promise<Result> {
    const slot: SearchSlot<Result> = { stalled: false, queued: null };
    slots.set(key, slot);
    const timeBox = new AbortController();
    const stallTimer = setTimeout(() => {
      slot.stalled = true;
      timeBox.abort(new Error(timeoutMessage));
    }, timeoutMs);
    stallTimer.unref?.();
    const runSignal = AbortSignal.any([signal, timeBox.signal]);
    const run = (async () => start(runSignal))();
    const finish = () => {
      clearTimeout(stallTimer);
      const next = slot.queued;
      if (next === null) {
        slots.delete(key);
        return;
      }
      next.settle(begin(key, next.start, next.signal));
    };
    run.then(finish, finish);
    return run;
  }

  async function wait(
    promise: Promise<Result | null>,
    signal: AbortSignal,
  ): Promise<Result | null> {
    return raceTimeout(
      unlessAborted(promise, signal),
      timeoutMs,
      timeoutMessage,
    );
  }

  return {
    async search(key, start, signal) {
      if (signal.aborted) return null;
      const slot = slots.get(key);
      if (slot === undefined) return wait(begin(key, start, signal), signal);
      if (slot.stalled) return null;
      slot.queued?.settle(null);
      let settle: QueuedSearch<Result>["settle"] = () => {};
      const promoted = new Promise<Result | null>((resolve) => {
        settle = resolve;
      });
      const entry: QueuedSearch<Result> = { start, signal, settle };
      slot.queued = entry;
      try {
        return await wait(promoted, signal);
      } finally {
        if (slot.queued === entry) slot.queued = null;
      }
    },
  };
}
