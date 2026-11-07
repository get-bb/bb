import type { Profiler } from "node:inspector";
import { findSourceMap } from "node:module";
import { roundDurationMs } from "./event-loop-delay.js";

import { EVENT_LOOP_GAP_INTERVAL_MS } from "./event-loop-gaps.js";
import {
  STALL_WINDOW_THRESHOLD_MS,
  type ProfileCodeOwner,
  type StallWindowBatch,
} from "./stall-windows.js";
type StallWindow = StallWindowBatch["windows"][number];

export const PROFILE_SAMPLING_INTERVAL_MS = 10;
const MAX_SAMPLE_MS = 2 * PROFILE_SAMPLING_INTERVAL_MS;

export function createStallSampleSummarizer(
  profile: Profiler.Profile,
  codeOwners: readonly ProfileCodeOwner[] = [],
) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const owners = new Map<number, string | null>();
  const ownerOf = (id: number): string | null => {
    const known = owners.get(id);
    if (known !== undefined) return known;
    const url = nodes.get(id)?.callFrame.url ?? "";
    const direct =
      url === ""
        ? undefined
        : codeOwners.find((entry) => url.includes(entry.location))?.owner;
    const parent = parents.get(id);
    const owner =
      direct ??
      (parent === undefined || parent === id ? null : ownerOf(parent));
    owners.set(id, owner);
    return owner;
  };
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
        return {
          sampledMs: roundDurationMs(duration),
          owner: ownerOf(id),
          frames,
        };
      });
    const ownedMs = new Map<string, number>();
    for (const [id, duration] of durations) {
      const owner = ownerOf(id);
      if (owner !== null)
        ownedMs.set(owner, (ownedMs.get(owner) ?? 0) + duration);
    }
    return {
      stallAttribution: stacks.length > 0 ? "sampled" : "unattributed",
      sampledMs: roundDurationMs(sampledMs),
      idleMs: roundDurationMs(idleMs),
      unobservedMs: roundDurationMs(
        Math.max(0, window.endedAt - window.startedAt - sampledMs),
      ),
      owners: [...ownedMs]
        .sort((left, right) => right[1] - left[1])
        .map(([owner, duration]) => ({
          owner,
          sampledMs: roundDurationMs(duration),
        })),
      stacks,
    };
  };
}

export function summarizeStallWindows(
  profile: Profiler.Profile,
  batch: StallWindowBatch,
  codeOwners: readonly ProfileCodeOwner[],
) {
  if (batch.windows.length === 0) return [];
  const summarize = createStallSampleSummarizer(profile, codeOwners);
  return batch.windows.map((window) => ({
    pid: process.pid,
    startedAt: new Date(batch.epochOffsetMs + window.startedAt).toISOString(),
    endedAt: new Date(batch.epochOffsetMs + window.endedAt).toISOString(),
    delayMs: roundDurationMs(window.endedAt - window.startedAt),
    resolutionMs: EVENT_LOOP_GAP_INTERVAL_MS,
    thresholdMs: STALL_WINDOW_THRESHOLD_MS,
    sampleTimeBasis: "elapsed",
    nativeFramesMayIncludeWaiting: true,
    maxSampleWeightMs: MAX_SAMPLE_MS,
    droppedWindows: batch.droppedWindows,
    ...summarize(window),
  }));
}
