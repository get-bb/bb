/**
 * Re-recording a bridge's side of the wire.
 *
 * A recording is never rewritten: the recorded `bridge→runtime` lane is the
 * recording, and a recording-time checkout paces its replay from it. When a
 * bridge change alters what the bridge emits for a recording, this writes
 * the bridge's current output to `bridge→runtime.current.ndjson` beside the
 * recorded lane (`CURRENT_BRIDGE_LANE_FILE`); `withCurrentBridgeLane` then
 * prefers it, so a self-replay compares a bridge with what it wrote last.
 *
 * Each re-recorded line is placed right after the runtime entry that was
 * sent last before it arrived (same `run`, a fractional `seq` between that
 * entry and the next), which is the wire order the replay and the gates
 * read. Bridge request ids are rewritten to the recorded ones, matched by
 * method and order, so the untouched runtime responses still name a request.
 *
 * The lane is written as the bridge emitted it. A committed fixture also
 * passes through a redactor (`scripts/provider-recordings/redact.mjs` in a
 * bb checkout): the caller owns that step.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BridgeRecordingDirection } from "../bridge-kit/bridge-recorder.js";
import {
  PARITY_INITIALIZE_ID,
  replayRecording,
  type ReplayRecordingOptions,
} from "./parity.js";
import { CURRENT_BRIDGE_LANE_FILE, readBridgeRecording } from "./recording.js";

const BRIDGE_TO_RUNTIME: BridgeRecordingDirection = "bridge→runtime";

export type RerecordCurrentBridgeLaneOptions = Omit<
  ReplayRecordingOptions,
  "planFromCurrentLane"
>;

export interface RerecordCurrentBridgeLaneResult {
  /** The file written, or null when the replay stalled and nothing was. */
  file: string | null;
  /** Lines in the new lane (the harness's own handshake excluded). */
  lines: number;
  /** Events the replay assembled. */
  events: number;
  /** A stalled replay leaves the current lane untouched. */
  stalls: string[];
}

interface WireMessage {
  id?: string | number;
  method?: string;
  [key: string]: unknown;
}

function parseWireLine(line: string): WireMessage | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as WireMessage)
      : null;
  } catch {
    return null;
  }
}

interface LaneEntry {
  ts: number;
  run: number;
  seq: number;
  dir: BridgeRecordingDirection;
  line: string;
}

/**
 * Replay one recording through a bridge and write what the bridge emitted
 * as the recording's current bridge lane. The replay plans its gates from
 * the recorded lane (or `createPlanAssembler`'s view of it), never from a
 * previous current lane: the new lane must reproduce the recorded session,
 * not the last re-recording of it.
 */
export async function rerecordCurrentBridgeLane(
  options: RerecordCurrentBridgeLaneOptions,
): Promise<RerecordCurrentBridgeLaneResult> {
  const recording = readBridgeRecording(options.recordingDir);
  const run = await replayRecording({ ...options, planFromCurrentLane: false });
  if (run.stalls.length > 0) {
    return { file: null, lines: 0, events: run.events.length, stalls: run.stalls };
  }
  // The first runtime entry anchors lines that arrive before any request
  // (a bridge speaks only after `initialize`, so this is a safety net).
  const firstRuntime = recording.entries.find(
    (entry) => entry.dir === "runtime→bridge",
  );
  // Bridge request ids are per process, and the recorded runtime lane answers
  // the ids the recording-time process used; a fresh bridge counts from one.
  const recordedRequestIds = new Map<string, Array<string | number>>();
  for (const entry of recording.entries) {
    if (entry.dir !== BRIDGE_TO_RUNTIME) continue;
    const message = parseWireLine(entry.line);
    if (message?.method === undefined || message.id === undefined) continue;
    const queue = recordedRequestIds.get(message.method) ?? [];
    queue.push(message.id);
    recordedRequestIds.set(message.method, queue);
  }
  const entries: LaneEntry[] = [];
  const perAnchor = new Map<string, number>();
  run.lines.forEach((rawLine, index) => {
    let line = rawLine;
    const message = parseWireLine(rawLine);
    if (message?.id === PARITY_INITIALIZE_ID) {
      // The harness's own handshake, not part of the recording.
      return;
    }
    if (message?.method !== undefined && message.id !== undefined) {
      const recordedId = recordedRequestIds.get(message.method)?.shift();
      if (recordedId !== undefined && recordedId !== message.id) {
        line = JSON.stringify({ ...message, id: recordedId });
      }
    }
    const anchor =
      run.lineAfter[index] ??
      (firstRuntime
        ? {
            run: firstRuntime.run,
            seq: firstRuntime.seq - 1,
            ts: firstRuntime.ts,
          }
        : { run: 0, seq: 0, ts: 0 });
    const anchorKey = `${anchor.run}:${anchor.seq}`;
    const ordinal = (perAnchor.get(anchorKey) ?? 0) + 1;
    perAnchor.set(anchorKey, ordinal);
    entries.push({
      ts: anchor.ts + ordinal,
      run: anchor.run,
      // Fractional: after the anchoring runtime entry, before the next one.
      seq: anchor.seq + ordinal / (run.lines.length + 1),
      dir: BRIDGE_TO_RUNTIME,
      line,
    });
  });
  const file = join(options.recordingDir, CURRENT_BRIDGE_LANE_FILE);
  writeFileSync(
    file,
    entries.map((entry) => JSON.stringify(entry)).join("\n") +
      (entries.length > 0 ? "\n" : ""),
  );
  return { file, lines: entries.length, events: run.events.length, stalls: [] };
}
