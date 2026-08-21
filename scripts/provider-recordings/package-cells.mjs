#!/usr/bin/env node
/**
 * Package raw bridge recordings into committed fixtures.
 *
 *   node scripts/provider-recordings/package-cells.mjs \
 *     --raw ~/.bb/provider-recordings/raw \
 *     --cells ~/.bb/provider-recordings/cells.tsv \
 *     --out packages/provider-bridge-protocol/recordings \
 *     --versions '{"codex":"codex-cli 0.149.0", ...}' \
 *     [--home <dir>]
 *
 * `cells.tsv` has one line per cell: `<provider>\t<cell>\t<threadId>\t<note>`.
 * A thread id of `_process` selects the last bridge process run that served
 * a `model/list` request (process-scoped cells). Each cell lands in
 * `<out>/<provider>/<cell>/` with its four lanes and a `manifest.json`, and
 * the whole output is passed through `redact.mjs`; the script refuses to
 * finish if the redaction sweep finds a survivor.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTIONS = ["runtime→bridge", "bridge→runtime", "provider→bridge", "bridge→provider"];

function parseArgs(argv) {
  const args = { home: undefined };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--") || value === undefined) {
      throw new Error(`bad argument ${key}`);
    }
    args[key.slice(2)] = value;
  }
  for (const required of ["raw", "cells", "out", "versions"]) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return { ...args, versions: JSON.parse(args.versions) };
}

function readLane(dir, direction) {
  const file = join(dir, `${direction}.ndjson`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function writeLane(dir, direction, entries) {
  if (entries.length === 0) return;
  writeFileSync(
    join(dir, `${direction}.ndjson`),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
}

/** The last run in a `_process` scope that answered `model/list`. */
function selectModelListRun(scopeDir) {
  const inbound = readLane(scopeDir, "runtime→bridge");
  let run;
  for (const entry of inbound) {
    try {
      if (JSON.parse(entry.line).method === "model/list") run = entry.run;
    } catch {
      // non-JSON lines carry no method
    }
  }
  if (run === undefined) {
    throw new Error(`no model/list request recorded under ${scopeDir}`);
  }
  return run;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cells = readFileSync(args.cells, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [provider, cell, threadId, note = ""] = line.split("\t");
      return { provider, cell, threadId, note };
    });

  const staging = mkdtempSync(join(tmpdir(), "bb-recording-cells-"));
  const summary = [];
  for (const { provider, cell, threadId, note } of cells) {
    const sourceDir = join(args.raw, provider, threadId);
    if (!existsSync(sourceDir)) {
      throw new Error(`missing raw recording ${sourceDir} for ${provider}/${cell}`);
    }
    const cellDir = join(staging, provider, cell);
    mkdirSync(cellDir, { recursive: true });
    const run = threadId === "_process" ? selectModelListRun(sourceDir) : undefined;
    const lanes = {};
    const runs = new Set();
    let firstTs = Number.POSITIVE_INFINITY;
    let lastTs = 0;
    for (const direction of DIRECTIONS) {
      const entries = readLane(sourceDir, direction).filter(
        (entry) => run === undefined || entry.run === run,
      );
      for (const entry of entries) {
        runs.add(entry.run);
        firstTs = Math.min(firstTs, entry.ts);
        lastTs = Math.max(lastTs, entry.ts);
      }
      lanes[direction] = entries.length;
      writeLane(cellDir, direction, entries);
    }
    const cliVersion = args.versions[provider];
    if (!cliVersion) throw new Error(`no CLI version given for ${provider}`);
    const manifest = {
      provider,
      cell,
      threadId: threadId === "_process" ? null : threadId,
      scope: threadId === "_process" ? "process" : "thread",
      cliVersion,
      recordedAt: new Date(firstTs).toISOString().slice(0, 10),
      description: describeCell(cell),
      note,
      bridgeRuns: runs.size,
      lines: lanes,
    };
    writeFileSync(join(cellDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    summary.push({ provider, cell, lines: lanes });
  }

  rmSync(args.out, { recursive: true, force: true });
  mkdirSync(dirname(args.out), { recursive: true });
  const redact = fileURLToPath(new URL("./redact.mjs", import.meta.url));
  execFileSync(
    process.execPath,
    [redact, staging, args.out, ...(args.home ? ["--home", args.home] : [])],
    { stdio: "inherit" },
  );
  rmSync(staging, { recursive: true, force: true });

  for (const { provider, cell, lines } of summary) {
    const total = Object.values(lines).reduce((sum, n) => sum + n, 0);
    console.log(`${provider}/${cell}: ${total} lines`);
  }
  console.log(`${summary.length} cells packaged under ${args.out}`);
  const sizes = readdirSync(args.out);
  console.log(`providers: ${sizes.join(", ")}`);
}

const CELL_DESCRIPTIONS = {
  "turn-tools": "One turn: read a file, edit it, run a shell command.",
  steer: "A long turn steered mid-way with a new instruction.",
  "stop-interrupt": "A turn interrupted by thread/stop, then a new turn on the resumed session.",
  "approval-allow": "accept-edits mode; an out-of-sandbox command approved once.",
  "approval-deny": "accept-edits mode; an out-of-sandbox command denied.",
  "user-question": "The agent asks the user a question and continues with the answer.",
  subagent: "The agent delegates one task to a subagent (where the provider has one).",
  resume: "A turn, a release stop, then a new turn that resumes the session.",
  fork: "A thread forked from a resumed source thread, then one turn.",
  "plan-mode": "A /plan turn (plan command mention).",
  "model-list": "Process-scoped model/list probe.",
  "web-search": "A turn that uses web search or fetch (or a shell fallback).",
  compaction: "A thread compacted after a turn (/compact).",
  "missing-rollout": "codex: resume after the rollout file was moved away.",
  "archived-resume": "codex: resume a thread archived natively by another app-server client.",
  "empty-rollout": "codex: resume after the rollout file was truncated to zero bytes.",
  "auth-failure": "A turn against an empty provider config home (401 / not logged in).",
};

function describeCell(cell) {
  return CELL_DESCRIPTIONS[cell] ?? cell;
}

main();
