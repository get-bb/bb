import { spawn } from "node:child_process";
import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DiskUsageInput,
  DiskUsageOutput,
  MeasuredTarget,
} from "./host-contract.js";
import { DiskUsageError, isFsErrorWithCode } from "./fs-errors.js";

type MeasureDiskUsageTarget = DiskUsageInput["targets"][number];

export interface DiskUsageOptions {
  duCommand: string | null;
  duConcurrency: number;
  duBatchMaxEntries: number;
  walkerConcurrency: number;
}

const DEFAULT_DISK_USAGE_OPTIONS: DiskUsageOptions = {
  duCommand: process.platform === "win32" ? null : "du",
  duConcurrency: 1,
  duBatchMaxEntries: 100,
  walkerConcurrency: 8,
};

const DU_BATCH_MAX_ARG_BYTES = 64 * 1024;
const DU_NICENESS = 10;
const DU_STDERR_TAIL_CHARS = 2_000;
const DU_LINE_PATTERN = /^(\d+)\t(.*)$/;
const SKIPPABLE_ENTRY_ERROR_CODES = ["ENOENT", "ENOTDIR", "EACCES", "EPERM"];

interface ScanSlots {
  available: number;
  waiting: Set<() => void>;
}

const duSlots: ScanSlots = { available: 1, waiting: new Set() };
const filesystemSlots: ScanSlots = { available: 8, waiting: new Set() };

async function withScanSlot<T>(
  slots: ScanSlots,
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  if (slots.available > 0) {
    slots.available--;
  } else {
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", aborted);
        resolve();
      };
      const aborted = () => {
        slots.waiting.delete(ready);
        reject(signal.reason);
      };
      slots.waiting.add(ready);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
  try {
    signal.throwIfAborted();
    return await run();
  } finally {
    const next = slots.waiting.values().next().value;
    if (next === undefined) {
      slots.available++;
    } else {
      slots.waiting.delete(next);
      next();
    }
  }
}

interface Measurement {
  signal: AbortSignal;
  largeFileMinBytes: number | null;
  largeFiles: LargeFile[];
  duCommand: string | null;
  duConcurrency: number;
  duBatchMaxEntries: number;
  walkerConcurrency: number;
}

interface SizeBucket {
  sizeBytes: number;
}

interface MeasuredChild extends SizeBucket {
  name: string;
}

interface DuRun {
  exitCode: number | null;
  stderr: string;
}

interface DuLine {
  path: string;
  sizeBytes: number;
}

type LargeFile = DiskUsageOutput["largeFiles"][number];

interface WalkEntry {
  path: string;
  bucket: SizeBucket;
}

interface Walk {
  measurement: Measurement;
  signal: AbortSignal;
  pending: WalkEntry[];
  multiplyLinkedInodes: Set<string>;
}

class DuUnavailableError extends Error {}

function isSkippableEntryError(error: unknown): boolean {
  return SKIPPABLE_ENTRY_ERROR_CODES.some((code) =>
    isFsErrorWithCode(error, code),
  );
}

function allocatedBytes(stats: Stats): number {
  return process.platform === "win32" ? stats.size : stats.blocks * 512;
}

async function lstatEntry(
  signal: AbortSignal,
  entryPath: string,
): Promise<Stats | null> {
  try {
    return await withScanSlot(filesystemSlots, signal, () =>
      fs.lstat(entryPath),
    );
  } catch (error) {
    if (isSkippableEntryError(error)) return null;
    throw error;
  }
}

async function readDirectoryEntries(
  signal: AbortSignal,
  directoryPath: string,
): Promise<Dirent[]> {
  try {
    return await withScanSlot(filesystemSlots, signal, () =>
      fs.readdir(directoryPath, { withFileTypes: true }),
    );
  } catch (error) {
    if (isSkippableEntryError(error)) return [];
    throw error;
  }
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  signal: AbortSignal,
  map: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  const pending = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of pending) {
      signal.throwIfAborted();
      results[index] = await map(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

function lowerPriority(pid: number): void {
  try {
    os.setPriority(pid, DU_NICENESS);
  } catch {
    return;
  }
}

async function runDu(
  measurement: Measurement,
  duCommand: string,
  args: string[],
  onLine: (line: DuLine) => void,
): Promise<DuRun> {
  return withScanSlot(duSlots, measurement.signal, () =>
    spawnDu(measurement, duCommand, args, onLine),
  );
}

function spawnDu(
  measurement: Measurement,
  duCommand: string,
  args: string[],
  onLine: (line: DuLine) => void,
): Promise<DuRun> {
  return new Promise((resolve, reject) => {
    measurement.signal.throwIfAborted();
    const child = spawn(duCommand, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let partial = "";
    let stderr = "";
    const emit = (text: string) => {
      const match = DU_LINE_PATTERN.exec(text);
      const [, kib, linePath] = match ?? [];
      if (kib !== undefined && linePath !== undefined)
        onLine({ path: linePath, sizeBytes: Number(kib) * 1024 });
    };
    const kill = (): void => {
      child.kill("SIGKILL");
    };
    measurement.signal.addEventListener("abort", kill, { once: true });
    if (child.pid !== undefined) lowerPriority(child.pid);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) emit(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-DU_STDERR_TAIL_CHARS);
    });
    child.once("error", (error) => {
      measurement.signal.removeEventListener("abort", kill);
      reject(
        isFsErrorWithCode(error, "ENOENT") ? new DuUnavailableError() : error,
      );
    });
    child.once("close", (exitCode) => {
      measurement.signal.removeEventListener("abort", kill);
      if (partial !== "") emit(partial);
      resolve({ exitCode, stderr: stderr.trim() });
    });
  });
}

function noteFile(measurement: Measurement, filePath: string, sizeBytes: number) {
  if (
    measurement.largeFileMinBytes !== null &&
    sizeBytes >= measurement.largeFileMinBytes
  )
    measurement.largeFiles.push({ path: filePath, sizeBytes });
}

function duFailure(targetPath: string, run: DuRun): DiskUsageError {
  const detail = run.stderr === "" ? "no output" : run.stderr;
  return new DiskUsageError(
    "disk_usage_failed",
    `du failed for "${targetPath}" (exit code ${run.exitCode ?? "none"}): ${detail}`,
  );
}

function batchDuOperands(
  operands: readonly string[],
  maxEntries: number,
): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchBytes = 0;
  for (const operand of operands) {
    const operandBytes = Buffer.byteLength(operand) + 1;
    if (
      batch.length > 0 &&
      (batch.length >= maxEntries ||
        batchBytes + operandBytes > DU_BATCH_MAX_ARG_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(operand);
    batchBytes += operandBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function measureOperandsWithDu(
  measurement: Measurement,
  duCommand: string,
  targetPath: string,
  operands: readonly string[],
): Promise<Map<string, number>> {
  const requested = new Set(operands);
  const sizes = new Map<string, number>();
  let previous: string | null = null;
  const run = await runDu(
    measurement,
    duCommand,
    [
      "-k",
      measurement.largeFileMinBytes === null ? "-s" : "-a",
      "--",
      ...operands,
    ],
    (line) => {
      if (requested.has(line.path)) sizes.set(line.path, line.sizeBytes);
      else if (previous === null || !previous.startsWith(`${line.path}/`))
        noteFile(measurement, line.path, line.sizeBytes);
      previous = line.path;
    },
  );
  if (run.exitCode !== 0 && run.exitCode !== 1) {
    throw duFailure(targetPath, run);
  }
  return sizes;
}

async function classifyChildren(
  measurement: Measurement,
  targetPath: string,
  entries: readonly Dirent[],
): Promise<{
  directories: string[];
  nonDirectories: MeasuredChild[];
  files: LargeFile[];
}> {
  const classified = await mapWithConcurrency(
    entries,
    measurement.walkerConcurrency,
    measurement.signal,
    async (entry): Promise<Stats | string | null> => {
      if (entry.isDirectory()) return entry.name;
      const stats = await lstatEntry(
        measurement.signal,
        path.join(targetPath, entry.name),
      );
      if (stats === null) return null;
      if (stats.isDirectory()) return entry.name;
      return stats;
    },
  );
  const directories: string[] = [];
  const nonDirectories: MeasuredChild[] = [];
  const files: LargeFile[] = [];
  classified.forEach((child, index) => {
    const entry = entries[index];
    if (typeof child === "string") directories.push(child);
    else if (child !== null && entry !== undefined) {
      nonDirectories.push({ name: entry.name, sizeBytes: allocatedBytes(child) });
      if (child.isFile())
        files.push({
          path: path.join(targetPath, entry.name),
          sizeBytes: allocatedBytes(child),
        });
    }
  });
  return { directories, nonDirectories, files };
}

async function measureChildDirectoriesWithDu(
  measurement: Measurement,
  duCommand: string,
  targetPath: string,
  names: readonly string[],
): Promise<MeasuredChild[]> {
  const operands = names.map((name) => ({
    name,
    operand: path.join(targetPath, name),
  }));
  const batches = batchDuOperands(
    operands
      .filter(({ name }) => !name.includes("\n"))
      .map(({ operand }) => operand),
    measurement.duBatchMaxEntries,
  );
  const measured = new Map<string, number>();
  for (const sizes of await mapWithConcurrency(
    batches,
    measurement.duConcurrency,
    measurement.signal,
    (batch) => measureOperandsWithDu(measurement, duCommand, targetPath, batch),
  )) {
    for (const [operand, sizeBytes] of sizes) measured.set(operand, sizeBytes);
  }
  const children = await mapWithConcurrency(
    operands,
    measurement.duConcurrency,
    measurement.signal,
    async ({ name, operand }): Promise<MeasuredChild | null> => {
      const sizeBytes =
        measured.get(operand) ?? (await walkEntryTotal(measurement, operand));
      return sizeBytes === null ? null : { name, sizeBytes };
    },
  );
  return children.filter((child) => child !== null);
}

async function measureDirectoryWithDu(
  measurement: Measurement,
  duCommand: string,
  target: MeasureDiskUsageTarget,
  targetPath: string,
  targetStats: Stats,
): Promise<MeasuredTarget> {
  if (!target.perChild) {
    const sizes = await measureOperandsWithDu(
      measurement,
      duCommand,
      targetPath,
      [targetPath],
    );
    const sizeBytes =
      sizes.get(targetPath) ?? (await walkEntryTotal(measurement, targetPath));
    if (sizeBytes === null) return { outcome: "missing", path: target.path };
    return {
      outcome: "measured",
      path: target.path,
      sizeBytes,
      children: null,
    };
  }

  const { directories, nonDirectories, files } = await classifyChildren(
    measurement,
    targetPath,
    await readDirectoryEntries(measurement.signal, targetPath),
  );
  const children = [
    ...(await measureChildDirectoriesWithDu(
      measurement,
      duCommand,
      targetPath,
      directories,
    )),
    ...nonDirectories,
  ];
  for (const file of files) noteFile(measurement, file.path, file.sizeBytes);
  return {
    outcome: "measured",
    path: target.path,
    sizeBytes: children.reduce(
      (total, child) => total + child.sizeBytes,
      allocatedBytes(targetStats),
    ),
    children,
  };
}

function countedBytes(walk: Walk, stats: Stats): number {
  if (!stats.isDirectory() && stats.nlink > 1) {
    const inode = `${stats.dev}:${stats.ino}`;
    if (walk.multiplyLinkedInodes.has(inode)) return 0;
    walk.multiplyLinkedInodes.add(inode);
  }
  return allocatedBytes(stats);
}

async function visitEntry(walk: Walk, entry: WalkEntry): Promise<void> {
  const stats = await lstatEntry(walk.signal, entry.path);
  if (stats === null) return;
  const sizeBytes = countedBytes(walk, stats);
  entry.bucket.sizeBytes += sizeBytes;
  if (stats.isFile()) noteFile(walk.measurement, entry.path, sizeBytes);
  if (!stats.isDirectory()) return;
  for (const child of await readDirectoryEntries(walk.signal, entry.path)) {
    walk.pending.push({
      path: path.join(entry.path, child.name),
      bucket: entry.bucket,
    });
  }
}

async function walkPending(walk: Walk, concurrency: number): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  for (;;) {
    if (walk.signal.aborted) {
      await Promise.allSettled(inFlight);
      walk.signal.throwIfAborted();
    }
    while (inFlight.size < concurrency && walk.pending.length > 0) {
      const entry = walk.pending.pop();
      if (entry === undefined) break;
      const task = visitEntry(walk, entry).finally(() => {
        inFlight.delete(task);
      });
      inFlight.add(task);
    }
    if (inFlight.size === 0) return;
    try {
      await Promise.race(inFlight);
    } catch (error) {
      await Promise.allSettled(inFlight);
      throw error;
    }
  }
}

function startWalk(measurement: Measurement): Walk {
  return {
    measurement,
    signal: measurement.signal,
    pending: [],
    multiplyLinkedInodes: new Set(),
  };
}

async function walkEntryTotal(
  measurement: Measurement,
  entryPath: string,
): Promise<number | null> {
  const stats = await lstatEntry(measurement.signal, entryPath);
  if (stats === null) return null;
  const walk = startWalk(measurement);
  const bucket: SizeBucket = { sizeBytes: countedBytes(walk, stats) };
  if (stats.isDirectory()) {
    for (const child of await readDirectoryEntries(
      measurement.signal,
      entryPath,
    )) {
      walk.pending.push({ path: path.join(entryPath, child.name), bucket });
    }
  }
  await walkPending(walk, measurement.walkerConcurrency);
  return bucket.sizeBytes;
}

async function measureDirectoryWithWalker(
  measurement: Measurement,
  target: MeasureDiskUsageTarget,
  targetPath: string,
  targetStats: Stats,
): Promise<MeasuredTarget> {
  const walk = startWalk(measurement);
  const entries = await readDirectoryEntries(measurement.signal, targetPath);
  const own: SizeBucket = { sizeBytes: countedBytes(walk, targetStats) };
  const children = entries.map((entry) => ({
    name: entry.name,
    sizeBytes: 0,
  }));
  for (const child of children) {
    walk.pending.push({
      path: path.join(targetPath, child.name),
      bucket: target.perChild ? child : own,
    });
  }
  await walkPending(walk, measurement.walkerConcurrency);

  if (!target.perChild) {
    return {
      outcome: "measured",
      path: target.path,
      sizeBytes: own.sizeBytes,
      children: null,
    };
  }
  return {
    outcome: "measured",
    path: target.path,
    sizeBytes: children.reduce(
      (total, child) => total + child.sizeBytes,
      own.sizeBytes,
    ),
    children,
  };
}

async function measureTarget(
  measurement: Measurement,
  target: MeasureDiskUsageTarget,
): Promise<MeasuredTarget> {
  const targetPath = path.resolve(target.path);
  const stats = await lstatEntry(measurement.signal, targetPath);
  if (stats === null) return { outcome: "missing", path: target.path };
  if (!stats.isDirectory()) {
    if (stats.isFile()) noteFile(measurement, targetPath, allocatedBytes(stats));
    return {
      outcome: "measured",
      path: target.path,
      sizeBytes: allocatedBytes(stats),
      children: null,
    };
  }

  const duCommand = measurement.duCommand;
  if (duCommand !== null && !targetPath.includes("\n")) {
    try {
      return await measureDirectoryWithDu(
        measurement,
        duCommand,
        target,
        targetPath,
        stats,
      );
    } catch (error) {
      if (!(error instanceof DuUnavailableError)) throw error;
      measurement.duCommand = null;
    }
  }
  return measureDirectoryWithWalker(measurement, target, targetPath, stats);
}

export async function measureDiskUsage(
  command: DiskUsageInput,
  options: DiskUsageOptions = DEFAULT_DISK_USAGE_OPTIONS,
  signal?: AbortSignal,
): Promise<DiskUsageOutput> {
  for (const target of command.targets) {
    if (!path.isAbsolute(target.path)) {
      throw new DiskUsageError("invalid_path", "Path must be absolute");
    }
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, command.timeoutMs);
  const measurement: Measurement = {
    signal:
      signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, signal]),
    largeFileMinBytes: command.largeFileMinBytes,
    largeFiles: [],
    duCommand: options.duCommand,
    duConcurrency: options.duConcurrency,
    duBatchMaxEntries: options.duBatchMaxEntries,
    walkerConcurrency: options.walkerConcurrency,
  };
  try {
    const targets = await mapWithConcurrency(
      command.targets,
      options.duConcurrency,
      measurement.signal,
      (target) => measureTarget(measurement, target),
    );
    return { targets, largeFiles: measurement.largeFiles };
  } catch (error) {
    if (timedOut) {
      throw new DiskUsageError(
        "disk_usage_timeout",
        `Disk usage measurement timed out after ${command.timeoutMs} ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
