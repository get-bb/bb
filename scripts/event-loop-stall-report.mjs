#!/usr/bin/env node
import { createReadStream, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";

const USAGE = `Usage: node scripts/event-loop-stall-report.mjs [options] [log files...]

Summarizes "Event loop stalled" lines from bb server logs. While the server
main thread is stalled, terminal input, output, and echo wait for it.

With no files, reads every server*.log in --logs-dir.

Options:
  --logs-dir <dir>   Directory to scan (default: ~/.bb/logs)
  --days <n>         Only count stalls from the last n days (default: 7)
  --min-ms <n>       Only count stalls at least this long (default: 0)
  --json             Print the full result as JSON
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "logs-dir": { type: "string", default: path.join(os.homedir(), ".bb", "logs") },
    days: { type: "string", default: "7" },
    "min-ms": { type: "string", default: "0" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const days = Number(args.days);
const minMs = Number(args["min-ms"]);
if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(minMs) || minMs < 0) {
  throw new Error("--days must be positive and --min-ms must be non-negative");
}
const since = Date.now() - days * 24 * 60 * 60 * 1000;

const files =
  positionals.length > 0
    ? positionals
    : readdirSync(args["logs-dir"])
        .filter((name) => /^server(\.\d+)?\.log$/.test(name))
        .map((name) => path.join(args["logs-dir"], name));

function parseStall(line) {
  if (!line.includes("Event loop stalled")) {
    return null;
  }
  const start = line.indexOf("{");
  if (start === -1) {
    return null;
  }
  try {
    const entry = JSON.parse(line.slice(start));
    if (entry.msg !== "Event loop stalled" || typeof entry.time !== "number") {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function percentile(sorted, q) {
  return sorted.length === 0
    ? null
    : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function countBy(entries, key) {
  const counts = new Map();
  for (const entry of entries) {
    const value = key(entry) ?? "(none)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].toSorted((a, b) => b[1] - a[1]).slice(0, 10));
}

async function main() {
  const seen = new Set();
  const stalls = [];
  for (const file of files) {
    const lines = readline.createInterface({ input: createReadStream(file) });
    for await (const line of lines) {
      const entry = parseStall(line);
      if (entry === null || entry.time < since || entry.maxDelayMs < minMs) {
        continue;
      }
      const key = `${entry.time}:${entry.maxDelayMs}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      stalls.push(entry);
    }
  }
  stalls.sort((a, b) => a.time - b.time);

  const delays = stalls.map((entry) => entry.maxDelayMs).toSorted((a, b) => a - b);
  const perDay = countBy(stalls, (entry) => new Date(entry.time).toISOString().slice(0, 10));
  const report = {
    files: files.length,
    days,
    stalls: stalls.length,
    stalledMsTotal: Math.round(delays.reduce((sum, value) => sum + value, 0)),
    maxDelayMs: {
      p50: percentile(delays, 0.5),
      p90: percentile(delays, 0.9),
      max: delays.at(-1) ?? null,
      over1000ms: delays.filter((value) => value >= 1000).length,
      over3000ms: delays.filter((value) => value >= 3000).length,
    },
    perDay: Object.fromEntries(Object.entries(perDay).toSorted(([a], [b]) => a.localeCompare(b))),
    stallAttribution: countBy(stalls, (entry) => entry.stallAttribution),
    stallCauseCandidate: countBy(stalls, (entry) => entry.stallCauseCandidate),
    longestSynchronousWork: countBy(stalls, (entry) => entry.longestSynchronousWork),
    inFlightWorkAtObservation: countBy(stalls, (entry) => entry.inFlightWorkAtObservation),
  };
  if (args.json) {
    console.log(JSON.stringify({ ...report, entries: stalls }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
