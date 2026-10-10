const INVALIDATION_CHANNELS = [
  "tasks:changed",
  "projects:changed",
  "comments:changed",
  "threads:changed",
] as const;

export type InvalidationChannel = (typeof INVALIDATION_CHANNELS)[number];

export interface TaskSignal {
  channel: InvalidationChannel;
  taskId: string | null;
}

const SIGNAL_BATCH_MS = 50;

function signalTaskId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const taskId: unknown = Reflect.get(payload, "taskId");
  return typeof taskId === "string" ? taskId : null;
}

export function signalTaskIds(
  signals: readonly TaskSignal[],
  channel: InvalidationChannel,
): string[] {
  const ids = new Set<string>();
  for (const signal of signals) {
    if (signal.channel === channel && signal.taskId !== null) {
      ids.add(signal.taskId);
    }
  }
  return [...ids];
}

interface TaskSignalSchedulerHost {
  channels: () => readonly InvalidationChannel[];
  relevantTaskIds: () => readonly string[] | undefined;
  isHidden: () => boolean;
  setTimer: (callback: () => void, delayMs: number) => () => void;
  refetch: () => void;
  refetchAfterFetch: () => void;
  preparePatch: (signals: TaskSignal[]) => (() => Promise<void>) | null;
}

interface TaskSignalScheduler {
  push: (channel: InvalidationChannel, payload: unknown) => void;
  flush: () => void;
  trackFetch: (start: () => Promise<void>) => Promise<void>;
  dispose: () => void;
}

export function createTaskSignalScheduler(
  host: TaskSignalSchedulerHost,
): TaskSignalScheduler {
  let pending = new Map<string, TaskSignal>();
  let cancelTimer: (() => void) | null = null;
  let inFlight = 0;
  let refetchQueued = false;
  let latestFetch: Promise<void> = Promise.resolve();
  let patchChain: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const handle = (signals: TaskSignal[]) => {
    const patch = signals.some((signal) => signal.taskId === null)
      ? null
      : host.preparePatch(signals);
    if (patch === null) {
      if (inFlight > 0) {
        refetchQueued = true;
      } else {
        host.refetch();
      }
      return;
    }
    const fetchInFlight = latestFetch;
    patchChain = patchChain.then(async () => {
      await fetchInFlight.catch(() => undefined);
      await patch();
    });
  };

  const flush = () => {
    clearTimer();
    if (host.isHidden()) return;
    const batch = [...pending.values()];
    pending = new Map();
    if (batch.length > 0) handle(batch);
  };

  return {
    push(channel, payload) {
      if (!host.channels().includes(channel)) return;
      const taskId = signalTaskId(payload);
      const relevant = host.relevantTaskIds();
      if (
        relevant !== undefined &&
        taskId !== null &&
        !relevant.includes(taskId)
      ) {
        return;
      }
      pending.set(`${channel}\n${taskId ?? ""}`, { channel, taskId });
      if (cancelTimer !== null) return;
      cancelTimer = host.setTimer(flush, SIGNAL_BATCH_MS);
    },
    flush,
    trackFetch(start) {
      inFlight += 1;
      const fetching = start().finally(() => {
        inFlight -= 1;
        if (inFlight > 0 || !refetchQueued) return;
        refetchQueued = false;
        host.refetchAfterFetch();
      });
      latestFetch = fetching;
      return fetching;
    },
    dispose() {
      clearTimer();
      pending = new Map();
    },
  };
}
