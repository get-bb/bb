import { monotonicNowMs, observeEventLoopGaps } from "./event-loop-gaps.js";

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

export const STALL_WINDOW_THRESHOLD_MS = 100;

export function startStallWindowCollector() {
  const epochOffsetMs = Date.now() - monotonicNowMs();
  let droppedWindows = 0;
  let windows: StallWindowBatch["windows"] = [];
  const gaps = observeEventLoopGaps((startedAt, endedAt) => {
    const duration = endedAt - startedAt;
    if (duration >= STALL_WINDOW_THRESHOLD_MS && duration < 60_000) {
      if (windows.length < 128) windows.push({ startedAt, endedAt });
      else droppedWindows++;
    }
  });
  return {
    take(): StallWindowBatch {
      gaps.flush();
      const batch = { epochOffsetMs, droppedWindows, windows };
      windows = [];
      droppedWindows = 0;
      return batch;
    },
    stop() {
      gaps.stop();
    },
  };
}
