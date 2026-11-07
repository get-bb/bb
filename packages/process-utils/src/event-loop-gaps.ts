export const EVENT_LOOP_GAP_INTERVAL_MS = 50;

type EventLoopGapObserver = (startedAt: number, endedAt: number) => void;

const observers = new Set<EventLoopGapObserver>();
let timer: NodeJS.Timeout | null = null;
let previousTickAt = 0;

export function monotonicNowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

function tick(): void {
  const endedAt = monotonicNowMs();
  const startedAt = previousTickAt;
  previousTickAt = endedAt;
  for (const observer of observers) observer(startedAt, endedAt);
}

export function observeEventLoopGaps(observer: EventLoopGapObserver): {
  flush: () => void;
  stop: () => void;
} {
  observers.add(observer);
  if (timer === null) {
    previousTickAt = monotonicNowMs();
    timer = setInterval(tick, EVENT_LOOP_GAP_INTERVAL_MS);
    timer.unref();
  }
  return {
    flush: () => {
      if (
        observers.has(observer) &&
        monotonicNowMs() - previousTickAt > EVENT_LOOP_GAP_INTERVAL_MS
      )
        tick();
    },
    stop: () => {
      observers.delete(observer);
      if (observers.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
