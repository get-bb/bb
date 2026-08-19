import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";

/**
 * Each `@pierre/diffs` worker downloads and compiles ~830 KB of JavaScript and
 * then holds a Shiki heap. Diff highlighting rarely has more than a few files
 * in flight, so a small pool already saturates the visible work; a large one
 * only multiplies the boot cost and memory.
 */
const DIFF_WORKER_POOL_MAX_SIZE = 4;
/**
 * Phones and tablets: two workers keep highlighting off the main thread while
 * leaving cores and memory for scrolling and the composer.
 */
const DIFF_WORKER_POOL_CONSTRAINED_MAX_SIZE = 2;
const DIFF_WORKER_POOL_MIN_SIZE = 1;
/**
 * `navigator.deviceMemory` (Chromium only; Safari does not expose it) reports
 * whole gigabytes, rounded down. Four gigabytes covers every phone and the
 * low-end tablets and laptops where extra workers cause memory pressure.
 */
const CONSTRAINED_DEVICE_MEMORY_GB = 4;

export interface DiffWorkerPoolEnvironment {
  hardwareConcurrency: number | undefined;
  /** `(pointer: coarse)` matches: a touch-first device. */
  coarsePointer: boolean;
  /** `navigator.deviceMemory` in gigabytes when the browser exposes it. */
  deviceMemory: number | undefined;
}

export function computeDiffWorkerPoolSize({
  hardwareConcurrency,
  coarsePointer,
  deviceMemory,
}: DiffWorkerPoolEnvironment): number {
  if (hardwareConcurrency === undefined || hardwareConcurrency <= 2) {
    return DIFF_WORKER_POOL_MIN_SIZE;
  }
  const constrained =
    coarsePointer ||
    (deviceMemory !== undefined &&
      deviceMemory <= CONSTRAINED_DEVICE_MEMORY_GB);
  const maxSize = constrained
    ? DIFF_WORKER_POOL_CONSTRAINED_MAX_SIZE
    : DIFF_WORKER_POOL_MAX_SIZE;
  return Math.max(
    DIFF_WORKER_POOL_MIN_SIZE,
    Math.min(maxSize, hardwareConcurrency - 1),
  );
}

function readDeviceMemory(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  // Not in lib.dom: Chromium-only Device Memory API. Narrow immediately.
  const value: unknown = Reflect.get(navigator, "deviceMemory");
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readCoarsePointer(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(POINTER_COARSE_QUERY).matches;
}

export function getDiffWorkerPoolSize(): number {
  return computeDiffWorkerPoolSize({
    hardwareConcurrency:
      typeof navigator !== "undefined"
        ? navigator.hardwareConcurrency
        : undefined,
    coarsePointer: readCoarsePointer(),
    deviceMemory: readDeviceMemory(),
  });
}

export function createDiffWorker(): Worker {
  return new Worker(
    new URL("@pierre/diffs/worker/worker-portable.js", import.meta.url),
    { name: "pierre-diffs-worker", type: "module" },
  );
}
