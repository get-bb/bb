import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { roundDurationMs } from "@bb/process-utils";

type EventLoopWorkLabel = string | (() => string);

interface EventLoopWorkFrame {
  id: number;
  label: EventLoopWorkLabel;
  parent: EventLoopWorkFrame | null;
  segment: boolean;
  dominantChild: CompletedEventLoopWork | null;
}

interface CompletedEventLoopWork {
  callerDescription: string | null;
  contextSwitches: MainThreadContextSwitches | null;
  cpuMs: number;
  dominantChild: CompletedEventLoopWork | null;
  durationMs: number;
  label: EventLoopWorkLabel;
}

interface MainThreadContextSwitches {
  involuntary: number;
  voluntary: number;
}

export interface MainThreadCost {
  cpuMs: number;
  involuntaryContextSwitches: number;
  voluntaryContextSwitches: number;
  wallMs: number;
}

interface MainThreadCostStart {
  cpu: NodeJS.CpuUsage;
  startedAt: number;
  usage: NodeJS.ResourceUsage;
}

interface EventLoopWorkSnapshot {
  inFlightWorkAtObservation: string | null;
  lastCompletedWork: string | null;
  lastCompletedWorkWallMs: number | null;
  longestSynchronousWork: string | null;
  longestSynchronousWorkCaller: string | null;
  longestSynchronousWorkWallMs: number | null;
  longestSynchronousWorkCpuMs: number | null;
  longestSynchronousWorkVoluntaryContextSwitches: number | null;
  longestSynchronousWorkInvoluntaryContextSwitches: number | null;
}

const DOMINANT_CHILD_SHARE = 0.5;

const activeFrames = new Map<number, EventLoopWorkFrame>();
const currentAsyncFrame = new AsyncLocalStorage<EventLoopWorkFrame>();
let currentSyncFrame: EventLoopWorkFrame | null = null;
let longestInWindow: CompletedEventLoopWork | null = null;
let nextFrameId = 1;
let lastCompleted: { label: EventLoopWorkLabel; durationMs: number } | null =
  null;

function currentFrame(): EventLoopWorkFrame | null {
  return currentSyncFrame ?? currentAsyncFrame.getStore() ?? null;
}

function currentAsyncParentFrame(): EventLoopWorkFrame | null {
  if (currentSyncFrame === null || currentSyncFrame.segment) {
    return currentAsyncFrame.getStore() ?? null;
  }
  return currentSyncFrame;
}

function describeLabel(label: EventLoopWorkLabel): string {
  return typeof label === "string" ? label : label();
}

function createFrame(
  label: EventLoopWorkLabel,
  parent: EventLoopWorkFrame | null,
  segment: boolean,
): EventLoopWorkFrame {
  const frame: EventLoopWorkFrame = {
    dominantChild: null,
    id: nextFrameId,
    label,
    parent,
    segment,
  };
  nextFrameId += 1;
  return frame;
}

function completeFrame(frame: EventLoopWorkFrame, durationMs: number): void {
  frame.parent = null;
  if (!frame.segment) {
    lastCompleted = { label: frame.label, durationMs };
  }
}

function recordSynchronousWork(
  completed: CompletedEventLoopWork,
  caller: EventLoopWorkFrame | null,
): void {
  if (caller !== null && caller === currentSyncFrame) {
    if (
      caller.dominantChild === null ||
      completed.durationMs > caller.dominantChild.durationMs
    ) {
      caller.dominantChild = completed;
    }
    return;
  }
  if (
    longestInWindow === null ||
    completed.durationMs > longestInWindow.durationMs
  ) {
    completed.callerDescription = formatCaller(caller);
    longestInWindow = completed;
  }
}

function dominantChildOf(
  frame: EventLoopWorkFrame,
  durationMs: number,
): CompletedEventLoopWork | null {
  const child = frame.dominantChild;
  frame.dominantChild = null;
  return child !== null && child.durationMs >= durationMs * DOMINANT_CHILD_SHARE
    ? child
    : null;
}

function formatWorkChain(work: CompletedEventLoopWork): string {
  const labels: string[] = [];
  let current: CompletedEventLoopWork | null = work;
  while (current !== null) {
    labels.push(describeLabel(current.label));
    current = current.dominantChild;
  }
  return labels.join(" > ");
}

function formatCaller(caller: EventLoopWorkFrame | null): string | null {
  const labels: string[] = [];
  for (let frame = caller; frame !== null; frame = frame.parent) {
    labels.push(describeLabel(frame.label));
  }
  return labels.length === 0 ? null : labels.reverse().join(" > ");
}

function formatLineage(root: EventLoopWorkFrame): string {
  const labels: string[] = [describeLabel(root.label)];
  let parent = root;
  for (;;) {
    const children: EventLoopWorkFrame[] = [...activeFrames.values()]
      .filter((frame) => frame.parent === parent)
      .sort((left, right) => left.id - right.id);
    const child = children[0];
    if (child === undefined) {
      break;
    }
    labels.push(describeLabel(child.label));
    parent = child;
  }
  return labels.join(" > ");
}

function formatActiveWork(): string | null {
  if (activeFrames.size === 0) {
    return null;
  }
  const roots = [...activeFrames.values()]
    .filter(
      (frame) => frame.parent === null || !activeFrames.has(frame.parent.id),
    )
    .sort((left, right) => left.id - right.id);
  return roots.map((root) => formatLineage(root)).join(" | ");
}

function roundNullableDurationMs(durationMs: number | null): number | null {
  return durationMs === null ? null : roundDurationMs(durationMs);
}

function getEventLoopWorkSnapshot(): EventLoopWorkSnapshot {
  const longest = longestInWindow;
  return {
    inFlightWorkAtObservation: formatActiveWork(),
    lastCompletedWork:
      lastCompleted === null ? null : describeLabel(lastCompleted.label),
    lastCompletedWorkWallMs:
      lastCompleted === null ? null : roundDurationMs(lastCompleted.durationMs),
    longestSynchronousWork: longest === null ? null : formatWorkChain(longest),
    longestSynchronousWorkCaller: longest?.callerDescription ?? null,
    longestSynchronousWorkCpuMs: roundNullableDurationMs(
      longest?.cpuMs ?? null,
    ),
    longestSynchronousWorkWallMs: roundNullableDurationMs(
      longest?.durationMs ?? null,
    ),
    longestSynchronousWorkVoluntaryContextSwitches:
      longest?.contextSwitches?.voluntary ?? null,
    longestSynchronousWorkInvoluntaryContextSwitches:
      longest?.contextSwitches?.involuntary ?? null,
  };
}

export function takeEventLoopWorkWindowSnapshot(): EventLoopWorkSnapshot {
  const snapshot = getEventLoopWorkSnapshot();
  longestInWindow = null;
  return snapshot;
}

export function startMainThreadCost(): MainThreadCostStart {
  return {
    cpu: process.threadCpuUsage(),
    startedAt: performance.now(),
    usage: process.resourceUsage(),
  };
}

export function finishMainThreadCost(
  start: MainThreadCostStart,
): MainThreadCost {
  const wallMs = performance.now() - start.startedAt;
  const cpu = process.threadCpuUsage(start.cpu);
  const usage = process.resourceUsage();
  return {
    cpuMs: (cpu.user + cpu.system) / 1_000,
    involuntaryContextSwitches:
      usage.involuntaryContextSwitches - start.usage.involuntaryContextSwitches,
    voluntaryContextSwitches:
      usage.voluntaryContextSwitches - start.usage.voluntaryContextSwitches,
    wallMs,
  };
}

function runSynchronousWorkFrame<T>(
  label: EventLoopWorkLabel,
  caller: EventLoopWorkFrame | null,
  segment: boolean,
  work: () => T,
): T {
  const frame = createFrame(label, caller, segment);
  const outerSyncFrame = currentSyncFrame;
  const cost = startMainThreadCost();
  currentSyncFrame = frame;
  try {
    return work();
  } finally {
    currentSyncFrame = outerSyncFrame;
    const measured = finishMainThreadCost(cost);
    const durationMs = measured.wallMs;
    completeFrame(frame, durationMs);
    recordSynchronousWork(
      {
        callerDescription: null,
        contextSwitches: {
          involuntary: measured.involuntaryContextSwitches,
          voluntary: measured.voluntaryContextSwitches,
        },
        cpuMs: measured.cpuMs,
        dominantChild: dominantChildOf(frame, durationMs),
        durationMs,
        label,
      },
      caller,
    );
  }
}

export function runEventLoopWorkSync<T>(
  label: EventLoopWorkLabel,
  work: () => T,
): T {
  return runSynchronousWorkFrame(label, currentFrame(), false, work);
}

export function recordCompletedEventLoopWork(
  label: EventLoopWorkLabel,
  durationMs: number,
  cpuMs: number,
): void {
  const caller = currentFrame();
  recordSynchronousWork(
    {
      callerDescription: null,
      contextSwitches: null,
      cpuMs,
      dominantChild: null,
      durationMs,
      label,
    },
    caller,
  );
}

export async function runEventLoopWork<T>(
  label: string,
  work: () => Promise<T> | T,
): Promise<T> {
  const frame = createFrame(label, currentAsyncParentFrame(), false);
  const startedAt = performance.now();
  activeFrames.set(frame.id, frame);
  const segmentCaller = currentSyncFrame ?? frame.parent;
  return currentAsyncFrame.run(frame, async () => {
    try {
      return await runSynchronousWorkFrame(
        `${label} (until first await)`,
        segmentCaller,
        true,
        work,
      );
    } finally {
      activeFrames.delete(frame.id);
      completeFrame(frame, performance.now() - startedAt);
    }
  });
}

export function resetEventLoopWorkForTests(): void {
  activeFrames.clear();
  currentSyncFrame = null;
  longestInWindow = null;
  lastCompleted = null;
  nextFrameId = 1;
}
