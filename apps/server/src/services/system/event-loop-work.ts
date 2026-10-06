import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { roundDurationMs } from "@bb/process-utils";

interface EventLoopWorkFrame {
  blocksEventLoop: boolean;
  id: number;
  label: string;
  parentId: number | null;
  startedAt: number;
}

interface CompletedEventLoopWork {
  blocksEventLoop: boolean;
  durationMs: number;
  cpuMs: number | null;
  label: string;
}

interface EventLoopWorkSnapshot {
  inFlightWorkAtObservation: string | null;
  lastCompletedWork: string | null;
  lastCompletedWorkWallMs: number | null;
  longestSynchronousWork: string | null;
  longestSynchronousWorkWallMs: number | null;
  longestSynchronousWorkCpuMs: number | null;
}

const activeFrames = new Map<number, EventLoopWorkFrame>();
const currentFrameId = new AsyncLocalStorage<number>();
const completedInWindow: CompletedEventLoopWork[] = [];
let nextFrameId = 1;
let lastCompleted: CompletedEventLoopWork | null = null;

function enterEventLoopWork(label: string, blocksEventLoop: boolean): number {
  const id = nextFrameId;
  nextFrameId += 1;
  activeFrames.set(id, {
    blocksEventLoop,
    id,
    label,
    parentId: currentFrameId.getStore() ?? null,
    startedAt: performance.now(),
  });
  return id;
}

function leaveEventLoopWork(id: number, cpuMs: number | null): void {
  const frame = activeFrames.get(id);
  activeFrames.delete(id);
  if (frame === undefined) {
    return;
  }
  const completed: CompletedEventLoopWork = {
    blocksEventLoop: frame.blocksEventLoop,
    cpuMs,
    durationMs: performance.now() - frame.startedAt,
    label: frame.label,
  };
  lastCompleted = completed;
  completedInWindow.push(completed);
}

function formatLineage(root: EventLoopWorkFrame): string {
  const labels: string[] = [root.label];
  let parentId = root.id;
  for (;;) {
    const children: EventLoopWorkFrame[] = [...activeFrames.values()]
      .filter((frame) => frame.parentId === parentId)
      .sort((left, right) => left.id - right.id);
    const child = children[0];
    if (child === undefined) {
      break;
    }
    labels.push(child.label);
    parentId = child.id;
  }
  return labels.join(" > ");
}

function formatActiveWork(): string | null {
  if (activeFrames.size === 0) {
    return null;
  }
  const roots = [...activeFrames.values()]
    .filter(
      (frame) => frame.parentId === null || !activeFrames.has(frame.parentId),
    )
    .sort((left, right) => left.id - right.id);
  return roots.map((root) => formatLineage(root)).join(" | ");
}

function selectLongestSynchronousWork(): CompletedEventLoopWork | null {
  let longest: CompletedEventLoopWork | null = null;
  for (const completed of completedInWindow) {
    if (!completed.blocksEventLoop) {
      continue;
    }
    if (longest === null || completed.durationMs > longest.durationMs) {
      longest = completed;
    }
  }
  return longest;
}

function getEventLoopWorkSnapshot(): EventLoopWorkSnapshot {
  const longest = selectLongestSynchronousWork();
  return {
    inFlightWorkAtObservation: formatActiveWork(),
    lastCompletedWork: lastCompleted?.label ?? null,
    lastCompletedWorkWallMs:
      lastCompleted === null ? null : roundDurationMs(lastCompleted.durationMs),
    longestSynchronousWork: longest?.label ?? null,
    longestSynchronousWorkCpuMs:
      longest === null || longest.cpuMs === null
        ? null
        : roundDurationMs(longest.cpuMs),
    longestSynchronousWorkWallMs:
      longest === null ? null : roundDurationMs(longest.durationMs),
  };
}

export function takeEventLoopWorkWindowSnapshot(): EventLoopWorkSnapshot {
  const snapshot = getEventLoopWorkSnapshot();
  completedInWindow.length = 0;
  return snapshot;
}

export function runEventLoopWorkSync<T>(label: string, work: () => T): T {
  const id = enterEventLoopWork(label, true);
  const cpuStart = process.threadCpuUsage();
  return currentFrameId.run(id, () => {
    try {
      return work();
    } finally {
      const cpu = process.threadCpuUsage(cpuStart);
      leaveEventLoopWork(id, (cpu.user + cpu.system) / 1_000);
    }
  });
}

export async function runEventLoopWork<T>(
  label: string,
  work: () => Promise<T> | T,
): Promise<T> {
  const id = enterEventLoopWork(label, false);
  return currentFrameId.run(id, async () => {
    try {
      return await work();
    } finally {
      leaveEventLoopWork(id, null);
    }
  });
}

export function resetEventLoopWorkForTests(): void {
  activeFrames.clear();
  completedInWindow.length = 0;
  lastCompleted = null;
  nextFrameId = 1;
}
