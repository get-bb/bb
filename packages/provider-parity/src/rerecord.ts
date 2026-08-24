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
 * The lane itself is written by `rerecordCurrentBridgeLane` (the published
 * harness core); this CLI adds the first-party bridge launch, the per-cell
 * loop, and the redaction pass a committed fixture needs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  firstPartyReplayBridge,
  readBridgeRecording,
  rerecordCurrentBridgeLane,
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

async function rerecordCell(
  cell: RecordedCell,
  args: CliArgs,
  planLeg: ParityLeg | null,
): Promise<string> {
  const bridge = firstPartyReplayBridge(cell.provider, checkoutRoot);
  const result = await rerecordCurrentBridgeLane({
    recordingDir: cell.dir,
    providerId: cell.provider,
    bridge: bridge.launch,
    profile: bridge.profile,
    createAssembler: createParityAssembler,
    ...(planLeg === null
      ? {}
      : { createPlanAssembler: planLeg.createAssembler }),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.verbose
      ? { onStderr: (text: string) => process.stderr.write(text) }
      : {}),
  });
  if (result.file === null) {
    return `STALL ${cellKey(cell)}: ${result.stalls.join("; ")} (current lane left untouched)`;
  }
  // The lane is bridge output from this machine: a bridge error can quote
  // the replay child's command line, with this checkout's paths in it. Pass
  // it through the recordings' redactor so a committed lane is clean by
  // construction, and fail loudly if a secret shape survives.
  redactInPlace(result.file);
  return `OK ${cellKey(cell)}: ${result.lines} bridge→runtime lines (${result.events} events)`;
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
