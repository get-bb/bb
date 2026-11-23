import { raceTimeout } from "./plugin-time-box.js";

interface QueuedSearch<Result> {
  start: () => Result | Promise<Result>;
  settle: (run: Promise<Result> | null) => void;
}

interface SearchSlot<Result> {
  stalled: boolean;
  queued: QueuedSearch<Result> | null;
}

export interface MentionSearchSlots<Key extends object, Result> {
  search(
    key: Key,
    start: () => Result | Promise<Result>,
  ): Promise<Result | null>;
}

export function createMentionSearchSlots<Key extends object, Result>(
  timeoutMs: number,
): MentionSearchSlots<Key, Result> {
  const slots = new WeakMap<Key, SearchSlot<Result>>();
  const timeoutMessage = `timed out after ${timeoutMs}ms`;

  function begin(
    key: Key,
    start: () => Result | Promise<Result>,
  ): Promise<Result> {
    const slot: SearchSlot<Result> = { stalled: false, queued: null };
    slots.set(key, slot);
    const stallTimer = setTimeout(() => {
      slot.stalled = true;
    }, timeoutMs);
    stallTimer.unref?.();
    const run = (async () => start())();
    const finish = () => {
      clearTimeout(stallTimer);
      const next = slot.queued;
      if (next === null) {
        slots.delete(key);
        return;
      }
      next.settle(begin(key, next.start));
    };
    run.then(finish, finish);
    return run;
  }

  return {
    async search(key, start) {
      const slot = slots.get(key);
      if (slot === undefined) {
        return raceTimeout(begin(key, start), timeoutMs, timeoutMessage);
      }
      if (slot.stalled) return null;
      slot.queued?.settle(null);
      let settle: QueuedSearch<Result>["settle"] = () => {};
      const promoted = new Promise<Result | null>((resolve) => {
        settle = resolve;
      });
      const entry: QueuedSearch<Result> = { start, settle };
      slot.queued = entry;
      try {
        return await raceTimeout(promoted, timeoutMs, timeoutMessage);
      } finally {
        if (slot.queued === entry) slot.queued = null;
      }
    },
  };
}
