#!/usr/bin/env node
/**
 * `pnpm rerecord [--plan-with <checkout>] [--provider <id>] [--cell <name>]
 *                [--recordings <dir>] [--timeout <ms>] [--verbose]`
 *
 * Writes each committed recording's `bridge→runtime.current.ndjson`: the
 * bridge's side of the wire as THIS checkout's bridge emits it for the
 * recording's provider and runtime lanes. The recording itself (provider
 * lanes, runtime lane, the recorded bridge lane) is never touched — a
 * pre-migration checkout paces its replay from the recorded lane — so the
 * current expectation lives beside it, and `parity.self.test.ts`
 * ("replaying the recording through the current bridge reproduces the
 * recorded output") reads it when present. Run `UPDATE_PARITY_ROW_COUNTS=1`
 * on the self-suite afterwards to re-pin the counts, and explain both diffs
 * in the PR.
 *
 * `--plan-with` names a checkout whose assembler parses the recorded lane
 * (the recording-time checkout): the replay plans where each runtime
 * request lands from that lane, which matters when this checkout's grammar
 * no longer accepts all of it.
 *
 * Each re-recorded line is placed right after the runtime entry that was
 * sent last before it arrived (same `run`, a fractional `seq` between that
 * entry and the next), which is the wire order the replay and the gates read.
 * Bridge request ids are rewritten to the recorded ones, matched by method
 * and order, so the untouched runtime responses still name a request.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { BridgeRecordingDirection } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  CURRENT_BRIDGE_LANE_FILE,
  PARITY_INITIALIZE_ID,
  replayRecording,
  readBridgeRecording,
} from "@bb/provider-bridge-protocol/testing/parity";
import {
  RECORDINGS_ROOT,
  cellKey,
  createParityAssembler,
  isReplayable,
  listRecordedCells,
  type RecordedCell,
} from "./index.js";
import { loadParityLeg, type ParityLeg } from "./leg.js";

const BRIDGE_TO_RUNTIME: BridgeRecordingDirection = "bridge→runtime";

const REDACT_SCRIPT = resolve(
  new URL("../../../scripts/provider-recordings/redact.mjs", import.meta.url).pathname,
);

/** Run `scripts/provider-recordings/redact.mjs` over one file, in place. */
function redactInPlace(file: string): void {
  const inDir = mkdtempSync(join(tmpdir(), "bb-rerecord-redact-in-"));
  const outDir = mkdtempSync(join(tmpdir(), "bb-rerecord-redact-out-"));
  try {
    const staged = join(inDir, basename(file));
    writeFileSync(staged, readFileSync(file));
    execFileSync(process.execPath, [REDACT_SCRIPT, inDir, outDir], { stdio: ["ignore", "ignore", "inherit"] });
    writeFileSync(file, readFileSync(join(outDir, basename(file))));
  } finally {
    rmSync(inDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
}

interface CliArgs {
  planRoot: string | null;
  provider: string | null;
  cell: string | null;
  recordings: string;
  timeoutMs: number | undefined;
  verbose: boolean;
}

function usage(): never {
  process.stderr.write(
    "usage: pnpm rerecord [--plan-with <checkout>] [--provider <id>] [--cell <name>] [--recordings <dir>] [--timeout <ms>] [--verbose]\n",
  );
  process.exit(2);
}

const callerCwd = process.env.INIT_CWD ?? process.cwd();
const checkoutRoot = resolve(new URL("../../..", import.meta.url).pathname);

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    planRoot: null,
    provider: null,
    cell: null,
    recordings: RECORDINGS_ROOT,
    timeoutMs: undefined,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--plan-with":
        args.planRoot = resolve(callerCwd, value ?? usage());
        index += 1;
        break;
      case "--provider":
        args.provider = value ?? usage();
        index += 1;
        break;
      case "--cell":
        args.cell = value ?? usage();
        index += 1;
        break;
      case "--recordings":
        args.recordings = resolve(callerCwd, value ?? usage());
        index += 1;
        break;
      case "--timeout":
        args.timeoutMs = Number(value ?? usage());
        index += 1;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      default:
        usage();
    }
  }
  return args;
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

async function rerecordCell(
  cell: RecordedCell,
  args: CliArgs,
  planLeg: ParityLeg | null,
): Promise<string> {
  const recording = readBridgeRecording(cell.dir);
  const run = await replayRecording({
    recordingDir: cell.dir,
    bridge: { checkoutRoot, providerId: cell.provider },
    createAssembler: createParityAssembler,
    ...(planLeg === null
      ? {}
      : { createPlanAssembler: planLeg.createAssembler }),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.verbose
      ? { onStderr: (text: string) => process.stderr.write(text) }
      : {}),
  });
  if (run.stalls.length > 0) {
    return `STALL ${cellKey(cell)}: ${run.stalls.join("; ")} (current lane left untouched)`;
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
  const target = join(cell.dir, CURRENT_BRIDGE_LANE_FILE);
  writeFileSync(
    target,
    entries.map((entry) => JSON.stringify(entry)).join("\n") +
      (entries.length > 0 ? "\n" : ""),
  );
  // The lane is bridge output from this machine: a bridge error can quote
  // the replay child's command line, with this checkout's paths in it. Pass
  // it through the recordings' redactor so a committed lane is clean by
  // construction, and fail loudly if a secret shape survives.
  redactInPlace(target);
  return `OK ${cellKey(cell)}: ${entries.length} bridge→runtime lines (${run.events.length} events)`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const planLeg =
    args.planRoot === null ? null : await loadParityLeg(args.planRoot);
  process.stdout.write(
    `record: ${checkoutRoot}\nplan: ${
      planLeg === null
        ? "this checkout's assembler over the recorded lane"
        : `${planLeg.checkoutRoot} (${planLeg.source})`
    }\n\n`,
  );
  const cells = listRecordedCells(args.recordings).filter(
    (cell: RecordedCell) =>
      (args.provider === null || cell.provider === args.provider) &&
      (args.cell === null || cell.cell === args.cell),
  );
  let failed = 0;
  for (const cell of cells) {
    if (!isReplayable(cell.provider)) {
      process.stdout.write(
        `SKIP ${cellKey(cell)}: provider is not replayable\n`,
      );
      continue;
    }
    if (readBridgeRecording(cell.dir).manifest?.scope === "process") {
      process.stdout.write(`SKIP ${cellKey(cell)}: process-scoped recording\n`);
      continue;
    }
    const line = await rerecordCell(cell, args, planLeg);
    if (line.startsWith("STALL")) failed += 1;
    process.stdout.write(`${line}\n`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
