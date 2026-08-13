import { performance } from "node:perf_hooks";
import { roundDurationMs } from "../lib/duration.js";

interface EventLoopWorkFrame {
  label: string;
  startedAt: number;
}

export interface EventLoopWorkSnapshot {
  currentWork: string | null;
  lastWork: string | null;
  lastWorkMs: number | null;
}

const workStack: EventLoopWorkFrame[] = [];
let lastCompleted: { label: string; durationMs: number } | null = null;

function formatWorkStack(frames: readonly EventLoopWorkFrame[]): string {
  return frames.map((frame) => frame.label).join(" > ");
}

function enterEventLoopWork(label: string): void {
  workStack.push({ label, startedAt: performance.now() });
}

function leaveEventLoopWork(): void {
  const frame = workStack.pop();
  if (frame === undefined) {
    return;
  }
  lastCompleted = {
    durationMs: performance.now() - frame.startedAt,
    label: frame.label,
  };
}

export function getEventLoopWorkSnapshot(): EventLoopWorkSnapshot {
  return {
    currentWork: workStack.length > 0 ? formatWorkStack(workStack) : null,
    lastWork: lastCompleted?.label ?? null,
    lastWorkMs:
      lastCompleted === null ? null : roundDurationMs(lastCompleted.durationMs),
  };
}

export function runEventLoopWorkSync<T>(label: string, work: () => T): T {
  enterEventLoopWork(label);
  try {
    return work();
  } finally {
    leaveEventLoopWork();
  }
}

export async function runEventLoopWork<T>(
  label: string,
  work: () => Promise<T> | T,
): Promise<T> {
  enterEventLoopWork(label);
  try {
    return await work();
  } finally {
    leaveEventLoopWork();
  }
}

export function resetEventLoopWorkForTests(): void {
  workStack.length = 0;
  lastCompleted = null;
}
