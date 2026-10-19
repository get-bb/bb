export interface StallWindowBatch {
  epochOffsetMs: number;
  droppedWindows: number;
  windows: { startedAt: number; endedAt: number }[];
}

export function parseStallWindowBatch(value: unknown): StallWindowBatch {
  if (
    typeof value !== "object" ||
    value === null ||
    !("epochOffsetMs" in value) ||
    typeof value.epochOffsetMs !== "number" ||
    !Number.isFinite(value.epochOffsetMs) ||
    !("droppedWindows" in value) ||
    typeof value.droppedWindows !== "number" ||
    !Number.isSafeInteger(value.droppedWindows) ||
    value.droppedWindows < 0 ||
    !("windows" in value) ||
    !Array.isArray(value.windows) ||
    value.windows.length > 128
  )
    throw new Error("Invalid stall window batch");
  const windows = value.windows.map((window: unknown) => {
    if (
      typeof window !== "object" ||
      window === null ||
      !("startedAt" in window) ||
      typeof window.startedAt !== "number" ||
      !Number.isFinite(window.startedAt) ||
      !("endedAt" in window) ||
      typeof window.endedAt !== "number" ||
      !Number.isFinite(window.endedAt) ||
      window.endedAt < window.startedAt
    )
      throw new Error("Invalid stall window");
    return { startedAt: window.startedAt, endedAt: window.endedAt };
  });
  return {
    epochOffsetMs: value.epochOffsetMs,
    droppedWindows: value.droppedWindows,
    windows,
  };
}

export function startStallWindowCollector() {
  const now = () => Number(process.hrtime.bigint()) / 1e6;
  const epochOffsetMs = Date.now() - now();
  let previous = now();
  let droppedWindows = 0;
  let windows: StallWindowBatch["windows"] = [];
  const observe = () => {
    const endedAt = now();
    const duration = endedAt - previous;
    if (duration >= 100 && duration < 60_000) {
      if (windows.length < 128) windows.push({ startedAt: previous, endedAt });
      else droppedWindows++;
    }
    previous = endedAt;
  };
  const timer = setInterval(observe, 20);
  timer.unref();
  return {
    take(): StallWindowBatch {
      observe();
      const batch = { epochOffsetMs, droppedWindows, windows };
      windows = [];
      droppedWindows = 0;
      return batch;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
