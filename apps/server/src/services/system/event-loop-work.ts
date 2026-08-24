import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { roundDurationMs } from "../lib/duration.js";

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
  label: string;
}

interface EventLoopWorkSnapshot {
  currentWork: string | null;
  lastWork: string | null;
  lastWorkMs: number | null;
  slowestWork: string | null;
  slowestWorkMs: number | null;
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

function leaveEventLoopWork(id: number): void {
  const frame = activeFrames.get(id);
  activeFrames.delete(id);
  if (frame === undefined) {
    return;
  }
  const completed: CompletedEventLoopWork = {
    blocksEventLoop: frame.blocksEventLoop,
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

function selectSlowestWork(): CompletedEventLoopWork | null {
  let slowest: CompletedEventLoopWork | null = null;
  for (const completed of completedInWindow) {
    if (!completed.blocksEventLoop) {
      continue;
    }
    if (slowest === null || completed.durationMs > slowest.durationMs) {
      slowest = completed;
    }
  }
  return slowest;
}

function getEventLoopWorkSnapshot(): EventLoopWorkSnapshot {
  const slowest = selectSlowestWork();
  return {
    currentWork: formatActiveWork(),
    lastWork: lastCompleted?.label ?? null,
    lastWorkMs:
      lastCompleted === null ? null : roundDurationMs(lastCompleted.durationMs),
    slowestWork: slowest?.label ?? null,
    slowestWorkMs:
      slowest === null ? null : roundDurationMs(slowest.durationMs),
  };
}

export function takeEventLoopWorkWindowSnapshot(): EventLoopWorkSnapshot {
  const snapshot = getEventLoopWorkSnapshot();
  completedInWindow.length = 0;
  return snapshot;
}

export function runEventLoopWorkSync<T>(label: string, work: () => T): T {
  const id = enterEventLoopWork(label, true);
  return currentFrameId.run(id, () => {
    try {
      return work();
    } finally {
      leaveEventLoopWork(id);
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
      leaveEventLoopWork(id);
    }
  });
}

export function resetEventLoopWorkForTests(): void {
  activeFrames.clear();
  completedInWindow.length = 0;
  lastCompleted = null;
  nextFrameId = 1;
}
