export interface FrameScheduler {
  requestAnimationFrame: (callback: () => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

const DEFERRED_REALIZATION_FRAMES = 2;
const DEFERRED_REALIZATION_TIMEOUT_MS = 120;

export function scheduleDeferredRealization(
  realize: () => void,
  scheduler: FrameScheduler,
): () => void {
  let done = false;
  let frameHandle: number | null = null;
  let remaining = DEFERRED_REALIZATION_FRAMES;

  const finish = () => {
    if (done) return;
    done = true;
    if (frameHandle !== null) scheduler.cancelAnimationFrame(frameHandle);
    scheduler.clearTimeout(timeoutHandle);
    realize();
  };

  const tick = () => {
    frameHandle = null;
    remaining -= 1;
    if (remaining <= 0) {
      finish();
      return;
    }
    frameHandle = scheduler.requestAnimationFrame(tick);
  };

  const timeoutHandle = scheduler.setTimeout(
    finish,
    DEFERRED_REALIZATION_TIMEOUT_MS,
  );
  frameHandle = scheduler.requestAnimationFrame(tick);

  return () => {
    if (done) return;
    done = true;
    if (frameHandle !== null) scheduler.cancelAnimationFrame(frameHandle);
    scheduler.clearTimeout(timeoutHandle);
  };
}
