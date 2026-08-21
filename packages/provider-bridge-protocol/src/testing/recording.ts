/**
 * Reading a bridge recording (see `bridge-kit/bridge-recorder.ts` for the
 * writer and `docs/provider-bridge-protocol.md`, "Record mode", for the
 * layout). A recording directory holds up to four `<direction>.ndjson` lanes
 * and, for a packaged fixture, a `manifest.json`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_RECORDING_DIRECTIONS,
  bridgeRecordingFileName,
  type BridgeRecordingDirection,
  type BridgeRecordingEntry,
} from "../bridge-kit/bridge-recorder.js";

/** The redacted fixtures this package ships, and the checkout they live in. */
export const COMMITTED_RECORDINGS_ROOT = fileURLToPath(
  new URL("../../recordings", import.meta.url),
);
export const RECORDINGS_CHECKOUT_ROOT = resolve(COMMITTED_RECORDINGS_ROOT, "../../..");

export interface BridgeRecordingManifest {
  provider: string;
  cell: string;
  threadId: string | null;
  scope: "thread" | "process";
  cliVersion: string;
  recordedAt: string;
  description: string;
  note: string;
  bridgeRuns: number;
  lines: Partial<Record<BridgeRecordingDirection, number>>;
}

export interface BridgeRecording {
  dir: string;
  manifest: BridgeRecordingManifest | null;
  /** Every lane merged back into wire order: by bridge process, then seq. */
  entries: BridgeRecordingEntry[];
}

/** `(run, seq)` order: exact within a process, chronological across them. */
export function compareRecordingEntries(
  left: BridgeRecordingEntry,
  right: BridgeRecordingEntry,
): number {
  return left.run - right.run || left.seq - right.seq;
}

function parseEntry(raw: string, file: string, lineNumber: number): BridgeRecordingEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${file}:${lineNumber}: not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as BridgeRecordingEntry).line !== "string" ||
    typeof (parsed as BridgeRecordingEntry).seq !== "number" ||
    typeof (parsed as BridgeRecordingEntry).dir !== "string"
  ) {
    throw new Error(`${file}:${lineNumber}: not a recording entry`);
  }
  const entry = parsed as BridgeRecordingEntry & { run?: number };
  // Entries written before the `run` stamp existed order by seq alone.
  return { ...entry, run: typeof entry.run === "number" ? entry.run : 0 };
}

export function readBridgeRecordingLane(
  dir: string,
  direction: BridgeRecordingDirection,
): BridgeRecordingEntry[] {
  const file = join(dir, bridgeRecordingFileName(direction));
  if (!existsSync(file)) {
    return [];
  }
  const entries: BridgeRecordingEntry[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, raw] of lines.entries()) {
    if (raw.length === 0) continue;
    const entry = parseEntry(raw, file, index + 1);
    if (entry.dir !== direction) {
      throw new Error(`${file}:${index + 1}: entry direction ${entry.dir} in the ${direction} lane`);
    }
    entries.push(entry);
  }
  return entries;
}

export function readBridgeRecording(dir: string): BridgeRecording {
  const manifestPath = join(dir, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as BridgeRecordingManifest)
    : null;
  const entries: BridgeRecordingEntry[] = [];
  for (const direction of BRIDGE_RECORDING_DIRECTIONS) {
    entries.push(...readBridgeRecordingLane(dir, direction));
  }
  entries.sort(compareRecordingEntries);
  return { dir, manifest, entries };
}

export interface RecordedCell {
  provider: string;
  cell: string;
  dir: string;
}

/**
 * Every `<provider>/<cell>` directory under a recordings root that holds at
 * least one lane, sorted for stable iteration.
 */
export function listRecordedCells(root: string): RecordedCell[] {
  const cells: RecordedCell[] = [];
  if (!existsSync(root)) {
    return cells;
  }
  for (const provider of readdirSync(root).sort()) {
    const providerDir = join(root, provider);
    if (!statSync(providerDir).isDirectory()) continue;
    for (const cell of readdirSync(providerDir).sort()) {
      const dir = join(providerDir, cell);
      if (!statSync(dir).isDirectory()) continue;
      const hasLane = BRIDGE_RECORDING_DIRECTIONS.some((direction) =>
        existsSync(join(dir, bridgeRecordingFileName(direction))),
      );
      if (hasLane) {
        cells.push({ provider, cell, dir });
      }
    }
  }
  return cells;
}
