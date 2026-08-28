import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  BRIDGE_RECORDING_DIRECTIONS,
  bridgeRecordingFileName,
  type BridgeRecordingDirection,
  type BridgeRecordingEntry,
} from "../bridge-kit/bridge-recorder.js";

export const COMMITTED_RECORDINGS_ROOT = fileURLToPath(
  new URL("../../recordings", import.meta.url),
);
export const RECORDINGS_CHECKOUT_ROOT = resolve(
  COMMITTED_RECORDINGS_ROOT,
  "../../..",
);

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
  entries: BridgeRecordingEntry[];
}

const bridgeRecordingEntrySchema = z
  .object({
    ts: z.number(),
    run: z.number().default(0),
    seq: z.number(),
    dir: z.enum(BRIDGE_RECORDING_DIRECTIONS),
    line: z.string(),
  })
  .passthrough();

const bridgeRecordingManifestSchema = z.object({
  provider: z.string(),
  cell: z.string(),
  threadId: z.string().nullable(),
  scope: z.enum(["thread", "process"]),
  cliVersion: z.string(),
  recordedAt: z.string(),
  description: z.string(),
  note: z.string(),
  bridgeRuns: z.number(),
  lines: z.record(z.string(), z.number()),
});

export function compareRecordingEntries(
  left: BridgeRecordingEntry,
  right: BridgeRecordingEntry,
): number {
  return left.run - right.run || left.seq - right.seq;
}

function parseEntry(
  raw: string,
  file: string,
  lineNumber: number,
): BridgeRecordingEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${file}:${lineNumber}: not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const result = bridgeRecordingEntrySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${file}:${lineNumber}: not a recording entry`);
  }
  return result.data;
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
      throw new Error(
        `${file}:${index + 1}: entry direction ${entry.dir} in the ${direction} lane`,
      );
    }
    entries.push(entry);
  }
  return entries;
}

export const CURRENT_BRIDGE_LANE_FILE = "bridge→runtime.current.ndjson";

export function readCurrentBridgeLane(
  dir: string,
): BridgeRecordingEntry[] | null {
  const file = join(dir, CURRENT_BRIDGE_LANE_FILE);
  if (!existsSync(file)) {
    return null;
  }
  const entries: BridgeRecordingEntry[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, raw] of lines.entries()) {
    if (raw.length === 0) continue;
    const entry = parseEntry(raw, file, index + 1);
    if (entry.dir !== "bridge→runtime") {
      throw new Error(
        `${file}:${index + 1}: entry direction ${entry.dir} in the current bridge lane`,
      );
    }
    entries.push(entry);
  }
  return entries;
}

export function withCurrentBridgeLane(
  recording: BridgeRecording,
): BridgeRecording {
  const current = readCurrentBridgeLane(recording.dir);
  if (current === null) {
    return recording;
  }
  const entries = [
    ...recording.entries.filter((entry) => entry.dir !== "bridge→runtime"),
    ...current,
  ];
  entries.sort(compareRecordingEntries);
  return { ...recording, entries };
}

export function readBridgeRecording(dir: string): BridgeRecording {
  const manifestPath = join(dir, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? bridgeRecordingManifestSchema.parse(
        JSON.parse(readFileSync(manifestPath, "utf8")),
      )
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
