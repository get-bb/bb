#!/usr/bin/env node
/**
 * `pnpm parity --old <checkout> --new . [--provider <id>] [--cell <name>]
 *              [--recordings <dir>] [--allowlist <file>] [--timeout <ms>] [--verbose]`
 *
 * Replay every committed recording through the bridge of two checkouts and
 * diff the assembled events and projected rows against the allowlist. Exit
 * 1 on any unallowed diff or stale allowlist entry, so the run doubles as a
 * gate. With `--old` equal to `--new` the diff must be empty: that is the
 * harness's own acceptance test.
 */
import { resolve } from "node:path";
import {
  ALLOWLIST_PATH,
  RECORDINGS_ROOT,
  cellKey,
  compareCell,
  countCellInputs,
  isReplayable,
  listRecordedCells,
  readAllowlist,
  readBridgeRecording,
  recordedCellInputs,
  replayCell,
  type ParityComparison,
  type RecordedCell,
} from "./index.js";
import { describeParityValue } from "@bb/provider-bridge-protocol/testing/parity";

interface CliArgs {
  oldRoot: string;
  newRoot: string;
  provider: string | null;
  cell: string | null;
  recordings: string;
  allowlist: string;
  timeoutMs: number | undefined;
  verbose: boolean;
}

function usage(): never {
  process.stderr.write(
    "usage: pnpm parity --old <checkout> --new <checkout> [--provider <id>] [--cell <name>] [--recordings <dir>] [--allowlist <file>] [--timeout <ms>] [--verbose]\n",
  );
  process.exit(2);
}

/** `pnpm parity` runs inside the package; resolve paths from the caller's cwd. */
const callerCwd = process.env.INIT_CWD ?? process.cwd();

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    oldRoot: "",
    newRoot: "",
    provider: null,
    cell: null,
    recordings: RECORDINGS_ROOT,
    allowlist: ALLOWLIST_PATH,
    timeoutMs: undefined,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--old":
        args.oldRoot = resolve(callerCwd, value ?? usage());
        index += 1;
        break;
      case "--new":
        args.newRoot = resolve(callerCwd, value ?? usage());
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
      case "--allowlist":
        args.allowlist = resolve(callerCwd, value ?? usage());
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
  if (args.oldRoot === "" || args.newRoot === "") {
    usage();
  }
  return args;
}

function formatComparison(comparison: ParityComparison): string[] {
  const lines: string[] = [];
  for (const [layer, diff] of [
    ["events", comparison.events],
    ["rows", comparison.rows],
  ] as const) {
    for (const value of diff.onlyInOld) {
      lines.push(`  ${layer} only in old: ${describeParityValue(value)}`);
    }
    for (const value of diff.onlyInNew) {
      lines.push(`  ${layer} only in new: ${describeParityValue(value)}`);
    }
  }
  for (const value of comparison.grammar.onlyInOld) {
    lines.push(`  grammar drop only in old: ${String(value)}`);
  }
  for (const value of comparison.grammar.onlyInNew) {
    lines.push(`  grammar drop only in new: ${String(value)}`);
  }
  for (const entry of comparison.staleAllowlist) {
    lines.push(`  stale allowlist entry (${entry.pr}): ${entry.layer} ${entry.path} — ${entry.reason}`);
  }
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allowlist = readAllowlist(args.allowlist);
  const cells = listRecordedCells(args.recordings).filter(
    (cell: RecordedCell) =>
      (args.provider === null || cell.provider === args.provider) &&
      (args.cell === null || cell.cell === args.cell),
  );
  if (cells.length === 0) {
    process.stderr.write(`no recordings matched under ${args.recordings}\n`);
    process.exit(2);
  }

  let failed = 0;
  let skipped = 0;
  for (const cell of cells) {
    const key = cellKey(cell);
    if (!isReplayable(cell.provider)) {
      skipped += 1;
      process.stdout.write(`SKIP ${key}: provider is not replayable (in-process SDK)\n`);
      continue;
    }
    if (readBridgeRecording(cell.dir).manifest?.scope === "process") {
      skipped += 1;
      process.stdout.write(`SKIP ${key}: process-scoped recording (no thread events to compare)\n`);
      continue;
    }
    const onStderr = args.verbose
      ? (text: string) => process.stderr.write(text)
      : undefined;
    const [oldInputs, newInputs] = await Promise.all([
      replayCell(cell, { checkoutRoot: args.oldRoot, timeoutMs: args.timeoutMs, onStderr }),
      replayCell(cell, { checkoutRoot: args.newRoot, timeoutMs: args.timeoutMs, onStderr }),
    ]);
    const comparison = compareCell(cell, oldInputs, newInputs, allowlist);
    const oldCounts = countCellInputs(oldInputs);
    const newCounts = countCellInputs(newInputs);
    const stalls = [...oldInputs.run.stalls, ...newInputs.run.stalls];
    const recorded = countCellInputs(recordedCellInputs(cell));
    // A replay that produced nothing where the recording produced events is
    // a broken replay, not parity; so is one the harness had to unblock.
    const empty = recorded.events > 0 && (oldCounts.events === 0 || newCounts.events === 0);
    const status = comparison.passed && stalls.length === 0 && !empty ? "PASS" : "FAIL";
    if (status === "FAIL") failed += 1;
    process.stdout.write(
      `${status} ${key}: old ${oldCounts.events} events/${oldCounts.rows} rows, new ${newCounts.events} events/${newCounts.rows} rows` +
        `, unhandled ${oldCounts.unhandled}→${newCounts.unhandled}` +
        `, grammar drops ${oldCounts.grammarDrops}→${newCounts.grammarDrops}` +
        (stalls.length > 0 ? `, ${stalls.length} stall(s)` : "") +
        "\n",
    );
    for (const line of formatComparison(comparison)) {
      process.stdout.write(`${line}\n`);
    }
    for (const stall of stalls) {
      process.stdout.write(`  stall: ${stall}\n`);
    }
    if (empty) {
      process.stdout.write(`  empty replay: the recording assembles ${recorded.events} events\n`);
    }
  }
  process.stdout.write(
    `\n${cells.length - skipped - failed} passed, ${failed} failed, ${skipped} skipped (${cells.length} cells)\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
