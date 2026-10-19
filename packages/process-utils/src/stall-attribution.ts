import type { Profiler } from "node:inspector";
import { findSourceMap } from "node:module";
import { roundDurationMs } from "./event-loop-delay.js";

import type { StallWindowBatch } from "./stall-windows.js";
type StallWindow = StallWindowBatch["windows"][number];

const MAX_SAMPLE_MS = 10;

export function createStallSampleSummarizer(profile: Profiler.Profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  return (window: StallWindow) => {
    const durations = new Map<number, number>();
    let at = profile.startTime / 1_000;
    let sampledMs = 0;
    let idleMs = 0;
    for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
      const delta = (profile.timeDeltas?.[i] ?? 0) / 1_000;
      const end = at + delta;
      const overlap = Math.max(
        0,
        Math.min(end, window.endedAt, profile.endTime / 1_000) -
          Math.max(at, end - MAX_SAMPLE_MS, window.startedAt),
      );
      at = end;
      const id = profile.samples![i]!;
      const node = nodes.get(id);
      if (!node || overlap === 0) continue;
      sampledMs += overlap;
      if (node.callFrame.functionName === "(idle)") {
        idleMs += overlap;
        continue;
      }
      if (["(program)", "(root)"].includes(node.callFrame.functionName))
        continue;
      durations.set(id, (durations.get(id) ?? 0) + overlap);
    }
    const stacks = [...durations]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([id, duration]) => {
        const frames = [];
        let current: number | undefined = id;
        const visited = new Set<number>();
        while (
          current !== undefined &&
          frames.length < 12 &&
          !visited.has(current)
        ) {
          visited.add(current);
          const node = nodes.get(current);
          if (!node) break;
          const frame = node.callFrame;
          const origin = findSourceMap(frame.url)?.findOrigin(
            frame.lineNumber + 1,
            frame.columnNumber + 1,
          );
          const source = origin && "fileName" in origin ? origin : undefined;
          frames.push({
            functionName: source?.name || frame.functionName || "(anonymous)",
            url: source?.fileName || frame.url,
            lineNumber: source?.lineNumber ?? frame.lineNumber + 1,
            columnNumber: source?.columnNumber ?? frame.columnNumber + 1,
          });
          current = parents.get(current);
        }
        return { sampledMs: roundDurationMs(duration), frames };
      });
    return {
      stallAttribution: stacks.length > 0 ? "sampled" : "unattributed",
      sampledMs: roundDurationMs(sampledMs),
      idleMs: roundDurationMs(idleMs),
      unobservedMs: roundDurationMs(
        Math.max(0, window.endedAt - window.startedAt - sampledMs),
      ),
      stacks,
    };
  };
}

export function summarizeStallWindows(
  profile: Profiler.Profile,
  batch: StallWindowBatch,
) {
  if (batch.windows.length === 0) return [];
  const summarize = createStallSampleSummarizer(profile);
  return batch.windows.map((window) => ({
    pid: process.pid,
    startedAt: new Date(batch.epochOffsetMs + window.startedAt).toISOString(),
    endedAt: new Date(batch.epochOffsetMs + window.endedAt).toISOString(),
    delayMs: roundDurationMs(window.endedAt - window.startedAt),
    resolutionMs: 20,
    thresholdMs: 100,
    sampleTimeBasis: "elapsed",
    nativeFramesMayIncludeWaiting: true,
    maxSampleWeightMs: MAX_SAMPLE_MS,
    droppedWindows: batch.droppedWindows,
    ...summarize(window),
  }));
}
